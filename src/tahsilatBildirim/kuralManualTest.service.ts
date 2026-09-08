/**
 * Büro sahibi onaylı tek-kural WhatsApp test gönderimi.
 * Normal otomasyon kuyruğunu / diğer tenantları işlemez; vade günü şartını yalnızca bu yolda baypas eder.
 * Sabit gönderim penceresi yoktur — manuel test her saatte çalışır.
 */
import type { Request } from 'express'
import {
  BildirimIsDurumu,
  BildirimKanali,
  BildirimKuralTuru,
  BildirimPlanKaynagi,
  BildirimProvider,
  Prisma,
  UserRole,
  VekaletTaksitOdemeDurumu
} from '@prisma/client'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { isWhatsAppBaglantiConnected } from './connection.public.js'
import { maskPhone, normalizeTurkiyePhone } from './phone.js'
import { isWhatsAppCloudApiAllowed } from './providers/whatsappProvider.js'
import { DEFAULT_TEMPLATES, renderTemplate, type TemplateVars } from './templates.js'
import { getLibraryEntry, getLibraryEntryByMetaName } from './templateLibrary.catalog.js'
import { buildSendBodyComponentsFromVars } from './templateLibrary.components.js'
import { ymdTr } from './time.js'
import { processDueJobs } from './worker.service.js'

function sumOdeme(tutarlar: { tutar: { toString: () => string } }[]): number {
  return tutarlar.reduce((s, o) => s + Number(o.tutar), 0)
}

function fmtMoney(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function fmtVadeTr(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}.${m}.${y}`
}

function assertBuroSahibi(role: UserRole): void {
  if (role !== UserRole.BURO_SAHIBI) {
    throw new AppError(403, 'Bu işlem yalnızca büro sahibi tarafından yapılabilir.', 'FORBIDDEN')
  }
}

async function loadKuralForTenant(tenantId: string, kuralId: string) {
  const kural = await prisma.tahsilatBildirimKurali.findFirst({
    where: { id: kuralId, tenantId },
    include: { metaSablon: true }
  })
  if (!kural) throw new AppError(404, 'Bildirim kuralı bulunamadı.', 'NOT_FOUND')
  return kural
}

async function loadTaksitForTenant(tenantId: string, taksitId: string) {
  const taksit = await prisma.vekaletTaksiti.findFirst({
    where: { id: taksitId, tenantId },
    include: {
      odemeler: { select: { tutar: true } },
      muvekkil: { select: { id: true, gorunenAd: true, telefon: true, aktifMi: true } },
      dosya: { select: { id: true, konuBasligi: true, dosyaNo: true, aktifMi: true } },
      tenant: { select: { buroAdi: true } }
    }
  })
  if (!taksit) throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')
  return taksit
}

function buildVars(taksit: Awaited<ReturnType<typeof loadTaksitForTenant>>, kuralTuru: BildirimKuralTuru): TemplateVars {
  const odenen = sumOdeme(taksit.odemeler)
  const taksitTutari = Number(taksit.tutar)
  const kalan = Math.max(0, taksitTutari - odenen)
  const vadeYmd = ymdTr(taksit.vadeTarihi)
  const todayYmd = ymdTr(new Date())
  const gecikme =
    kuralTuru === BildirimKuralTuru.VADE_SONRASI
      ? Math.max(
          0,
          Math.round(
            (new Date(`${todayYmd}T12:00:00+03:00`).getTime() -
              new Date(`${vadeYmd}T12:00:00+03:00`).getTime()) /
              86_400_000
          )
        )
      : 0
  const dosyaBilgisi = taksit.dosya.dosyaNo
    ? `${taksit.dosya.konuBasligi} (${taksit.dosya.dosyaNo})`
    : taksit.dosya.konuBasligi
  return {
    muvekkilAdi: taksit.muvekkil.gorunenAd,
    buroAdi: taksit.tenant.buroAdi,
    dosyaBilgisi,
    taksitTutari: fmtMoney(taksitTutari),
    odenenTutar: fmtMoney(odenen),
    kalanTutar: fmtMoney(kalan),
    vadeTarihi: fmtVadeTr(vadeYmd),
    gecikmeGunu: String(gecikme || (kuralTuru === BildirimKuralTuru.VADE_SONRASI ? 1 : 0))
  }
}

function testIdempotencyKey(
  tenantId: string,
  kuralId: string,
  taksitId: string,
  phoneDigits: string,
  day: string
): string {
  return `manual-kural-test|${tenantId}|${kuralId}|${taksitId}|${phoneDigits}|${day}`
}

export async function listKuralTestAdayTaksitler(
  tenantId: string,
  role: UserRole,
  q?: string
): Promise<{ items: Array<Record<string, unknown>> }> {
  assertBuroSahibi(role)
  const term = q?.trim()
  const rows = await prisma.vekaletTaksiti.findMany({
    where: {
      tenantId,
      odemeDurumu: { not: VekaletTaksitOdemeDurumu.IPTAL },
      dosya: { aktifMi: true },
      muvekkil: { aktifMi: true },
      ...(term
        ? {
            OR: [
              { muvekkil: { gorunenAd: { contains: term, mode: 'insensitive' } } },
              { dosya: { konuBasligi: { contains: term, mode: 'insensitive' } } },
              { dosya: { dosyaNo: { contains: term, mode: 'insensitive' } } }
            ]
          }
        : {})
    },
    include: {
      odemeler: { select: { tutar: true } },
      muvekkil: { select: { gorunenAd: true } },
      dosya: { select: { konuBasligi: true, dosyaNo: true } }
    },
    orderBy: [{ vadeTarihi: 'asc' }, { taksitNo: 'asc' }],
    take: 40
  })

  const items = rows
    .map((t) => {
      const odenen = sumOdeme(t.odemeler)
      const kalan = Math.max(0, Number(t.tutar) - odenen)
      return {
        id: t.id,
        taksitNo: t.taksitNo,
        vadeTarihi: t.vadeTarihi.toISOString(),
        vadeYmd: ymdTr(t.vadeTarihi),
        tutar: Number(t.tutar).toFixed(2),
        kalanTutar: kalan.toFixed(2),
        odemeDurumu: t.odemeDurumu,
        muvekkilAd: t.muvekkil.gorunenAd,
        dosyaBaslik: t.dosya.konuBasligi,
        dosyaNo: t.dosya.dosyaNo,
        label: `${t.muvekkil.gorunenAd} — ${t.dosya.konuBasligi} / Taksit #${t.taksitNo} (vade ${ymdTr(t.vadeTarihi)})`
      }
    })
    .filter((t) => Number(t.kalanTutar) > 0.001)

  return { items }
}

export async function previewKuralTest(
  tenantId: string,
  role: UserRole,
  kuralId: string,
  taksitId: string
): Promise<Record<string, unknown>> {
  assertBuroSahibi(role)
  const kural = await loadKuralForTenant(tenantId, kuralId)
  if (!kural.aktifMi) {
    throw new AppError(409, 'Pasif kural için test gönderilemez. Önce kuralı aktif edin.', 'RULE_INACTIVE')
  }
  const taksit = await loadTaksitForTenant(tenantId, taksitId)
  const kalan = Math.max(0, Number(taksit.tutar) - sumOdeme(taksit.odemeler))
  if (kalan <= 0.001) {
    throw new AppError(409, 'Ödenmiş taksit için test gönderilemez.', 'TAKSIT_PAID')
  }

  const vars = buildVars(taksit, kural.kuralTuru)
  const localSablon = await prisma.tahsilatBildirimSablonu.findUnique({
    where: {
      tenantId_kuralTuru_kanal: {
        tenantId,
        kuralTuru: kural.kuralTuru,
        kanal: BildirimKanali.WHATSAPP
      }
    }
  })
  const templateText = localSablon?.metin ?? DEFAULT_TEMPLATES[kural.kuralTuru]
  const rendered = renderTemplate(templateText, vars)

  const meta = kural.metaSablon
  const libraryKey =
    meta?.libraryKey ||
    (meta ? getLibraryEntryByMetaName(meta.metaName)?.libraryKey : null) ||
    kural.libraryKey ||
    null
  const entry = libraryKey ? getLibraryEntry(libraryKey) : null
  const components =
    meta && meta.statusNormalized === 'ONAYLANDI' && entry
      ? buildSendBodyComponentsFromVars(entry, vars)
      : null

  return {
    kuralId: kural.id,
    kuralTuru: kural.kuralTuru,
    taksit: {
      id: taksit.id,
      taksitNo: taksit.taksitNo,
      vadeYmd: ymdTr(taksit.vadeTarihi),
      kalanTutar: kalan.toFixed(2),
      muvekkilAd: taksit.muvekkil.gorunenAd,
      dosyaBaslik: taksit.dosya.konuBasligi
    },
    metaSablon: meta
      ? {
          id: meta.id,
          metaName: meta.metaName,
          language: meta.language,
          statusNormalized: meta.statusNormalized,
          libraryKey: meta.libraryKey
        }
      : null,
    degiskenler: vars,
    onizlemeMetin: rendered.ok ? rendered.text : null,
    onizlemeEksik: rendered.ok ? [] : rendered.missing,
    templateHazir:
      Boolean(meta && meta.statusNormalized === 'ONAYLANDI' && entry && components && components.ok),
    templateEksik:
      components && !components.ok ? components.missing : !meta ? ['metaSablon'] : !entry ? ['libraryKey'] : [],
    notlar: [
      'Test, vade günü şartını bilinçli olarak geçer; gönderim her saatte yapılabilir.',
      'Gerçek onaylı Meta şablonu ve worker gönderim yolu kullanılır.',
      'Mesaj, girdiğiniz test telefonuna gider; müvekkil telefonu kullanılmaz.'
    ]
  }
}

export async function sendKuralTest(input: {
  tenantId: string
  userId: string
  role: UserRole
  kuralId: string
  taksitId: string
  testTelefon: string
  confirm: true
  req: Request
}): Promise<Record<string, unknown>> {
  assertBuroSahibi(input.role)
  if (!input.confirm) {
    throw new AppError(400, 'Gerçek gönderim için onay zorunludur.', 'CONFIRM_REQUIRED')
  }

  const toE164 = normalizeTurkiyePhone(input.testTelefon.trim())
  if (!toE164) {
    throw new AppError(400, 'Test telefonu geçersiz. Örn. 05xx xxx xx xx', 'INVALID_PHONE')
  }

  if (!isWhatsAppCloudApiAllowed()) {
    throw new AppError(503, 'WhatsApp Cloud API özelliği kapalı.', 'FEATURE_DISABLED')
  }

  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId: input.tenantId } })
  if (!baglanti || !isWhatsAppBaglantiConnected(baglanti.durum)) {
    throw new AppError(400, 'Tenant WhatsApp bağlantısı aktif değil.', 'WHATSAPP_NOT_CONNECTED')
  }

  const kural = await loadKuralForTenant(input.tenantId, input.kuralId)
  if (!kural.aktifMi) {
    throw new AppError(409, 'Pasif kural için test gönderilemez.', 'RULE_INACTIVE')
  }
  if (!kural.metaSablonId || !kural.metaSablon || kural.metaSablon.statusNormalized !== 'ONAYLANDI') {
    throw new AppError(
      409,
      'Bu kurala onaylı Meta şablonu atanmamış. Önce şablon seçin.',
      'TEMPLATE_REQUIRED'
    )
  }

  const taksit = await loadTaksitForTenant(input.tenantId, input.taksitId)
  const kalan = Math.max(0, Number(taksit.tutar) - sumOdeme(taksit.odemeler))
  if (kalan <= 0.001) {
    throw new AppError(409, 'Ödenmiş taksit için test gönderilemez.', 'TAKSIT_PAID')
  }

  const day = ymdTr(new Date())
  const key = testIdempotencyKey(input.tenantId, kural.id, taksit.id, toE164, day)
  const existing = await prisma.tahsilatBildirimIsi.findUnique({ where: { idempotencyKey: key } })

  // Yalnızca başarılı gönderim veya hâlâ işlenen kayıt tekrar gönderimi engeller.
  // BASARISIZ / ATLANDI / IPTAL vb. yeniden denenebilir.
  if (
    existing &&
    (existing.durum === BildirimIsDurumu.GONDERILDI ||
      existing.durum === BildirimIsDurumu.TESLIM_EDILDI ||
      existing.durum === BildirimIsDurumu.OKUNDU) &&
    existing.providerMessageId
  ) {
    const delivered =
      existing.durum === BildirimIsDurumu.TESLIM_EDILDI ||
      existing.durum === BildirimIsDurumu.OKUNDU
    return {
      ok: true,
      idempotent: true,
      durum: existing.durum,
      deliveryLabel: delivered ? 'TESLIM_EDILDI' : 'META_KABUL',
      jobId: existing.id,
      providerMessageId: existing.providerMessageId,
      telefonMaskeli: existing.telefonMaskeli ?? maskPhone(toE164),
      message: delivered
        ? 'Teslim edildi (önceki test; ikinci gönderim yok).'
        : 'Meta kabul etti (önceki test wamid; ikinci gönderim yok). Teslim için webhook bekleniyor.',
      webhook: {
        statusRaw: null,
        errorCode: null,
        received: delivered,
        overrideActive: null,
        hasOverrideCallback: null,
        lastWebhookAt: null
      }
    }
  }

  if (existing && existing.durum === BildirimIsDurumu.KUYRUKTA && existing.lockedAt) {
    const age = Date.now() - existing.lockedAt.getTime()
    if (age < 60_000) {
      throw new AppError(409, 'Test gönderimi sürüyor; lütfen bekleyin.', 'IN_FLIGHT')
    }
  }

  const job = existing
    ? await prisma.tahsilatBildirimIsi.update({
        where: { id: existing.id },
        data: {
          durum: BildirimIsDurumu.KUYRUKTA,
          lockedAt: null,
          lockedBy: null,
          planlananAt: new Date(),
          kalanTutarSnapshot: new Prisma.Decimal(kalan.toFixed(2)),
          manuelTetikleme: true,
          provider: BildirimProvider.WHATSAPP_CLOUD_API,
          providerAdi: 'WHATSAPP_CLOUD_API',
          telefonMaskeli: maskPhone(toE164),
          hataOzeti: null,
          atlamaNedeni: null,
          sonProviderHataKodu: null,
          providerMessageId: null
        }
      })
    : await prisma.tahsilatBildirimIsi.create({
        data: {
          tenantId: input.tenantId,
          muvekkilId: taksit.muvekkilId,
          dosyaId: taksit.dosyaId,
          taksitId: taksit.id,
          kanal: BildirimKanali.WHATSAPP,
          provider: BildirimProvider.WHATSAPP_CLOUD_API,
          kuralTuru: kural.kuralTuru,
          planlananAt: new Date(),
          kalanTutarSnapshot: new Prisma.Decimal(kalan.toFixed(2)),
          durum: BildirimIsDurumu.KUYRUKTA,
          manuelTetikleme: true,
          idempotencyKey: key,
          planKaynagi: BildirimPlanKaynagi.VARSAYILAN,
          planVersion: 1,
          telefonMaskeli: maskPhone(toE164),
          providerAdi: 'WHATSAPP_CLOUD_API'
        }
      })

  const meta = getRequestMeta(input.req)
  await writeAuditLog({
    tenantId: input.tenantId,
    userId: input.userId,
    action: 'WHATSAPP_KURAL_TEST_SEND',
    entityType: 'TahsilatBildirimIsi',
    entityId: job.id,
    meta: {
      test: true,
      kuralId: kural.id,
      kuralTuru: kural.kuralTuru,
      taksitId: taksit.id,
      telefonMaskeli: maskPhone(toE164),
      metaSablon: kural.metaSablon.metaName,
      retryOfFailed: Boolean(
        existing &&
          existing.durum !== BildirimIsDurumu.GONDERILDI &&
          existing.durum !== BildirimIsDurumu.KUYRUKTA
      )
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  // bypassAutomationGates: local/prod WHATSAPP_AUTOMATION_ENABLED=false olsa bile
  // yalnızca onlyJobIds ile seçilen bu test işini işler; normal kuyruğa dokunmaz.
  const workerResult = await processDueJobs({
    onlyJobIds: [job.id],
    tenantId: input.tenantId,
    workerId: `kural-test-${input.userId.slice(0, 8)}`,
    bypassSendWindow: true,
    bypassEligibility: true,
    bypassAutomationGates: true,
    overrideToE164: toE164,
    limit: 1
  })

  const after = await prisma.tahsilatBildirimIsi.findUnique({
    where: { id: job.id },
    select: {
      id: true,
      durum: true,
      providerMessageId: true,
      hataOzeti: true,
      sonProviderHataKodu: true,
      atlamaNedeni: true,
      telefonMaskeli: true
    }
  })

  if (!after) {
    throw new AppError(500, 'Test iş kaydı bulunamadı.', 'JOB_MISSING')
  }

  if (
    after.durum === BildirimIsDurumu.GONDERILDI ||
    after.durum === BildirimIsDurumu.TESLIM_EDILDI ||
    after.durum === BildirimIsDurumu.OKUNDU
  ) {
    const delivered =
      after.durum === BildirimIsDurumu.TESLIM_EDILDI || after.durum === BildirimIsDurumu.OKUNDU
    const webhookEvent = after.providerMessageId
      ? await prisma.whatsAppWebhookEvent.findFirst({
          where: {
            providerMessageId: after.providerMessageId,
            OR: [{ statusRaw: { in: ['delivered', 'read', 'failed'] } }, { eventType: 'status' }]
          },
          orderBy: { createdAt: 'desc' },
          select: {
            statusRaw: true,
            errorCode: true,
            processedOk: true,
            createdAt: true
          }
        })
      : null

    const baglantiInfo = await prisma.whatsAppBaglanti.findUnique({
      where: { tenantId: input.tenantId },
      select: {
        webhookOverrideActive: true,
        webhookOverrideCallback: true,
        lastWebhookAt: true
      }
    })

    return {
      ok: true,
      idempotent: false,
      durum: after.durum,
      deliveryLabel: delivered ? 'TESLIM_EDILDI' : 'META_KABUL',
      jobId: after.id,
      providerMessageId: after.providerMessageId,
      telefonMaskeli: after.telefonMaskeli,
      message: delivered
        ? 'Teslim edildi.'
        : 'Meta kabul etti (wamid alındı). Teslim durumu için webhook bekleniyor.',
      webhook: {
        statusRaw: webhookEvent?.statusRaw ?? null,
        errorCode: webhookEvent?.errorCode ?? null,
        received: Boolean(webhookEvent),
        overrideActive: Boolean(baglantiInfo?.webhookOverrideActive),
        hasOverrideCallback: Boolean(baglantiInfo?.webhookOverrideCallback),
        lastWebhookAt: baglantiInfo?.lastWebhookAt?.toISOString() ?? null
      },
      worker: {
        processed: workerResult.processed,
        basarisiz: workerResult.basarisiz
      }
    }
  }

  const lastDeneme = await prisma.tahsilatBildirimDeneme.findFirst({
    where: { isId: job.id, tenantId: input.tenantId },
    orderBy: { createdAt: 'desc' },
    select: { sonucKodu: true, sonucMesaji: true, mesajOzeti: true }
  })

  let metaError: Record<string, unknown> | null = null
  const rawJson = lastDeneme?.mesajOzeti?.trim()
  if (rawJson && rawJson !== 'MASKED' && rawJson.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>
      metaError = {
        httpStatus: parsed.httpStatus ?? null,
        message: parsed.message ?? null,
        type: parsed.type ?? null,
        code: parsed.code ?? null,
        error_subcode: parsed.error_subcode ?? null,
        error_user_title: parsed.error_user_title ?? null,
        error_user_msg: parsed.error_user_msg ?? null,
        details: parsed.details ?? null,
        fbtrace_id: parsed.fbtrace_id ?? null
      }
    } catch {
      metaError = null
    }
  }
  if (!metaError && after.sonProviderHataKodu) {
    metaError = {
      code: after.sonProviderHataKodu,
      message: after.hataOzeti || lastDeneme?.sonucMesaji || null
    }
  }

  const safeError =
    after.hataOzeti ||
    after.atlamaNedeni ||
    lastDeneme?.sonucMesaji ||
    after.sonProviderHataKodu ||
    'Gönderim tamamlanamadı.'

  return {
    ok: false,
    durum: after.durum,
    jobId: after.id,
    providerMessageId: after.providerMessageId,
    telefonMaskeli: after.telefonMaskeli,
    errorCode: after.sonProviderHataKodu,
    message: safeError,
    metaError,
    worker: {
      processed: workerResult.processed,
      basarisiz: workerResult.basarisiz,
      skippedTemplateRequired: workerResult.skippedTemplateRequired
    }
  }
}
