/**
 * SUPER_ADMIN kontrollü tek Cloud session (serbest text) testi.
 * - Alıcı açık body `to` ile (WHATSAPP_CLOUD_TEST_PHONE kullanılmaz)
 * - Tenant WhatsAppBaglanti (encrypted token + phoneNumberId)
 * - webhook override / subscribed_apps / register yok
 * - Meta template kullanılmaz (yalnızca 24s customer service window text)
 * - Mesaj gövdesi audit/deneme’de MASKED
 */
import {
  BildirimIsDurumu,
  BildirimKanali,
  BildirimKuralTuru,
  BildirimProvider,
  Prisma
} from '@prisma/client'
import type { Request } from 'express'
import { writeAdminAuditLog } from '../admin/adminAudit.service.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { env } from '../config/env.js'
import { AppError } from '../middleware/errorHandler.js'
import { prisma } from '../lib/prisma.js'
import { isWhatsAppBaglantiConnected } from './connection.public.js'
import { maskPhone, normalizeTurkiyePhone } from './phone.js'
import { resolveWhatsAppProvider } from './providers/whatsappProvider.js'
import { ymdTr } from './time.js'

export const CONTROLLED_SESSION_TEST_TEXT = 'Müvekkil Kasa WhatsApp API bağlantı testi.'

const TERMINAL: BildirimIsDurumu[] = [
  BildirimIsDurumu.GONDERILDI,
  BildirimIsDurumu.TESLIM_EDILDI,
  BildirimIsDurumu.OKUNDU
]

function digits(raw: string): string {
  return raw.replace(/\D/g, '')
}

function idemKey(tenantId: string, toDigits: string, day: string): string {
  return `cloud-session-test|${tenantId}|${toDigits}|${day}`
}

async function resolveAnchorTaksit(tenantId: string, toDigits: string) {
  const muvekkiller = await prisma.muvekkil.findMany({
    where: { tenantId },
    select: { id: true, telefon: true, yetkiliTelefon: true },
    take: 500
  })
  const matched = muvekkiller.find((m) => {
    for (const raw of [m.telefon, m.yetkiliTelefon]) {
      if (!raw?.trim()) continue
      const n = normalizeTurkiyePhone(raw.trim())
      if (n && n === toDigits) return true
    }
    return false
  })

  const muvekkilId = matched?.id
  const taksit = await prisma.vekaletTaksiti.findFirst({
    where: muvekkilId ? { tenantId, muvekkilId } : { tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      muvekkilId: true,
      dosyaId: true,
      tutar: true,
      odemeler: { select: { tutar: true } }
    }
  })
  if (!taksit) {
    throw new AppError(
      422,
      'Kontrollü test için tenantta en az bir taksit/müvekkil kaydı gerekir (FK).',
      'TEST_ANCHOR_MISSING'
    )
  }
  const odenen = taksit.odemeler.reduce((s, o) => s + Number(o.tutar), 0)
  const kalan = Math.max(0, Number(taksit.tutar) - odenen)
  return {
    taksitId: taksit.id,
    muvekkilId: taksit.muvekkilId,
    dosyaId: taksit.dosyaId,
    kalan,
    matchedMuvekkil: Boolean(matched)
  }
}

/**
 * Gerçek Meta text gönderimi — yalnızca confirm=true ve açık `to` ile.
 * Çift gönderimi DB idempotencyKey ile engeller.
 */
export async function sendControlledSessionCloudTextTest(
  adminId: string,
  input: { tenantId: string; to: string; confirm: true },
  req: Request
): Promise<Record<string, unknown>> {
  if (!input.confirm) {
    throw new AppError(400, 'Gerçek gönderim için confirm=true zorunludur.', 'CONFIRM_REQUIRED')
  }
  if (!env.WHATSAPP_CLOUD_API_ENABLED) {
    throw new AppError(503, 'WhatsApp Cloud API özelliği kapalı.', 'FEATURE_DISABLED')
  }

  const tenantId = input.tenantId.trim()
  const toNorm = normalizeTurkiyePhone(input.to.trim()) || digits(input.to)
  if (toNorm.length < 10) {
    throw new AppError(400, 'Test alıcı telefonu geçersiz.', 'INVALID_PHONE')
  }

  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  if (!baglanti || !isWhatsAppBaglantiConnected(baglanti.durum)) {
    throw new AppError(400, 'Tenant WhatsApp bağlantısı aktif değil.', 'WHATSAPP_NOT_CONNECTED')
  }
  if (baglanti.webhookOverrideActive) {
    throw new AppError(
      409,
      'Bu test yalnızca webhookOverrideActive=false (paylaşılan/import) bağlantı için.',
      'OVERRIDE_ACTIVE_NOT_ALLOWED'
    )
  }

  const day = ymdTr(new Date())
  const key = idemKey(tenantId, toNorm, day)
  const existing = await prisma.tahsilatBildirimIsi.findUnique({
    where: { idempotencyKey: key },
    include: { denemeler: { orderBy: { createdAt: 'asc' }, take: 5 } }
  })
  if (existing && TERMINAL.includes(existing.durum) && existing.providerMessageId) {
    return {
      ok: true,
      idempotent: true,
      jobId: existing.id,
      connectionId: baglanti.id,
      durum: existing.durum,
      providerMessageId: existing.providerMessageId,
      denemeSayisi: existing.denemeler.length,
      webhookOverrideActive: false,
      note: 'Aynı gün/alıcı için önceki başarılı test (ikinci gönderim yok). TESLIM/OKUNDU beklenmez.'
    }
  }

  const anchor = await resolveAnchorTaksit(tenantId, toNorm)
  const job =
    existing ??
    (await prisma.tahsilatBildirimIsi.create({
      data: {
        tenantId,
        muvekkilId: anchor.muvekkilId,
        dosyaId: anchor.dosyaId,
        taksitId: anchor.taksitId,
        kanal: BildirimKanali.WHATSAPP,
        provider: BildirimProvider.WHATSAPP_CLOUD_API,
        kuralTuru: BildirimKuralTuru.VADE_GUNU,
        planlananAt: new Date(),
        kalanTutarSnapshot: new Prisma.Decimal(anchor.kalan.toFixed(2)),
        durum: BildirimIsDurumu.KUYRUKTA,
        manuelTetikleme: true,
        idempotencyKey: key,
        telefonMaskeli: maskPhone(toNorm)
      },
      include: { denemeler: true }
    }))

  if (job.denemeler.some((d) => d.basariliMi) && job.providerMessageId) {
    return {
      ok: true,
      idempotent: true,
      jobId: job.id,
      connectionId: baglanti.id,
      durum: job.durum,
      providerMessageId: job.providerMessageId,
      denemeSayisi: job.denemeler.length,
      webhookOverrideActive: false,
      note: 'Önceki başarılı deneme var; yeniden gönderilmedi.'
    }
  }

  const provider = resolveWhatsAppProvider('WHATSAPP_CLOUD_API')
  const sendResult = await provider.send({
    tenantId,
    toE164: toNorm,
    text: CONTROLLED_SESSION_TEST_TEXT,
    idempotencyKey: key
    // templateName yok — session free text
  })

  const telefonMaskeli = maskPhone(toNorm)
  const meta = getRequestMeta(req)

  if (!sendResult.ok) {
    await prisma.$transaction([
      prisma.tahsilatBildirimDeneme.create({
        data: {
          tenantId,
          isId: job.id,
          provider: 'WHATSAPP_CLOUD_API',
          basariliMi: false,
          telefonMaskeli,
          sablonOzeti: 'CONTROLLED_SESSION_TEXT',
          mesajOzeti: 'MASKED',
          sonucKodu: sendResult.code || 'FAILED',
          sonucMesaji: sendResult.message.slice(0, 400)
        }
      }),
      prisma.tahsilatBildirimIsi.update({
        where: { id: job.id },
        data: {
          durum: BildirimIsDurumu.BASARISIZ,
          hataOzeti: sendResult.message.slice(0, 400),
          sonProviderHataKodu: sendResult.code,
          provider: BildirimProvider.WHATSAPP_CLOUD_API,
          providerAdi: 'WHATSAPP_CLOUD_API',
          telefonMaskeli,
          denemeSayisi: { increment: 1 },
          sonDenemeAt: new Date()
        }
      })
    ])
    await writeAdminAuditLog({
      adminId,
      action: 'WHATSAPP_CONTROLLED_SESSION_TEST_FAILED',
      entityType: 'WhatsAppBaglanti',
      entityId: baglanti.id,
      newValue: {
        tenantId,
        connectionId: baglanti.id,
        jobId: job.id,
        code: sendResult.code,
        webhookOverrideActive: false
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(502, 'Meta Cloud API session text gönderimi başarısız.', sendResult.code)
  }

  const providerMessageId = sendResult.providerMessageId?.trim() || null
  if (!providerMessageId) {
    throw new AppError(502, 'Meta API message id dönmedi; gönderildi sayılmaz.', 'NO_MESSAGE_ID')
  }

  const denemeCount = await prisma.tahsilatBildirimDeneme.count({ where: { isId: job.id } })
  await prisma.$transaction([
    prisma.tahsilatBildirimDeneme.create({
      data: {
        tenantId,
        isId: job.id,
        provider: 'WHATSAPP_CLOUD_API',
        basariliMi: true,
        telefonMaskeli,
        sablonOzeti: 'CONTROLLED_SESSION_TEXT',
        mesajOzeti: 'MASKED',
        sonucKodu: sendResult.code,
        sonucMesaji: sendResult.message.slice(0, 200)
      }
    }),
    prisma.tahsilatBildirimIsi.update({
      where: { id: job.id },
      data: {
        durum: BildirimIsDurumu.GONDERILDI,
        provider: BildirimProvider.WHATSAPP_CLOUD_API,
        providerAdi: 'WHATSAPP_CLOUD_API',
        providerMessageId,
        telefonMaskeli,
        sonProviderHataKodu: null,
        hataOzeti: null,
        atlamaNedeni: null,
        denemeSayisi: { increment: 1 },
        sonDenemeAt: new Date()
      }
    })
  ])

  await writeAdminAuditLog({
    adminId,
    action: 'WHATSAPP_CONTROLLED_SESSION_TEST_SENT',
    entityType: 'WhatsAppBaglanti',
    entityId: baglanti.id,
    newValue: {
      tenantId,
      connectionId: baglanti.id,
      jobId: job.id,
      providerMessageId,
      durum: 'GONDERILDI',
      webhookOverrideActive: false,
      matchedMuvekkil: anchor.matchedMuvekkil,
      note: 'TESLIM/OKUNDU üretilmedi / assert edilmedi'
      // message body yok
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return {
    ok: true,
    idempotent: false,
    jobId: job.id,
    connectionId: baglanti.id,
    phoneNumberId: baglanti.phoneNumberId,
    wabaId: baglanti.wabaId,
    durum: BildirimIsDurumu.GONDERILDI,
    providerMessageId,
    denemeSayisi: denemeCount + 1,
    telefonMaskeli,
    webhookOverrideActive: false,
    webhookStatusExpected: false,
    message: 'MASKED'
  }
}
