import { BildirimIsDurumu, BildirimKuralTuru, BildirimProvider, Prisma } from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { isWhatsAppBaglantiConnected } from './connection.public.js'
import { buildBildirimMesaji } from './messageTemplate.service.js'
import { maskPhone, normalizeTurkiyePhone } from './phone.js'
import { resolveWhatsAppProvider } from './providers/whatsappProvider.js'

function sumOdeme(tutarlar: { tutar: { toString: () => string } }[]): number {
  return tutarlar.reduce((s, o) => s + Number(o.tutar), 0)
}

function resolvePhone(muvekkil: { telefon: string | null; yetkiliTelefon: string | null }): string | null {
  for (const raw of [muvekkil.telefon, muvekkil.yetkiliTelefon]) {
    const n = raw?.trim() ? normalizeTurkiyePhone(raw.trim()) : null
    if (n) return n
  }
  return null
}

type JobWithRelations = Prisma.TahsilatBildirimIsiGetPayload<{
  include: {
    taksit: { include: { odemeler: { select: { tutar: true } } } }
    muvekkil: { select: { gorunenAd: true; telefon: true; yetkiliTelefon: true } }
    dosya: { select: { konuBasligi: true; dosyaNo: true } }
    tenant: { select: { buroAdi: true } }
  }
}>

async function renderMessageForJob(job: JobWithRelations, overrideText?: string): Promise<string> {
  const text = overrideText?.trim()
  if (text) return text

  const odenen = sumOdeme(job.taksit.odemeler)
  const kalan = Math.max(0, Number(job.taksit.tutar) - odenen)
  const built = await buildBildirimMesaji({
    tenantId: job.tenantId,
    kuralTuru: job.kuralTuru,
    muvekkilAdi: job.muvekkil.gorunenAd,
    buroAdi: job.tenant.buroAdi,
    dosyaBaslik: job.dosya.konuBasligi,
    dosyaNo: job.dosya.dosyaNo,
    vadeTarihi: job.taksit.vadeTarihi,
    taksitTutari: Number(job.taksit.tutar),
    odenenTutar: odenen,
    kalanTutar: kalan
  })
  if (!built.ok) {
    throw new AppError(422, `Şablon değişkenleri eksik: ${built.missing.join(', ')}`, 'INVALID_TEMPLATE')
  }
  return built.text
}

async function loadJob(tenantId: string, jobId: string): Promise<JobWithRelations> {
  const job = await prisma.tahsilatBildirimIsi.findFirst({
    where: { id: jobId, tenantId },
    include: {
      taksit: { include: { odemeler: { select: { tutar: true } } } },
      muvekkil: { select: { gorunenAd: true, telefon: true, yetkiliTelefon: true } },
      dosya: { select: { konuBasligi: true, dosyaNo: true } },
      tenant: { select: { buroAdi: true } }
    }
  })
  if (!job) throw new AppError(404, 'Bildirim kaydı bulunamadı.', 'NOT_FOUND')
  return job
}

const TERMINAL_DURUMLAR: BildirimIsDurumu[] = [
  BildirimIsDurumu.GONDERILDI,
  BildirimIsDurumu.TESLIM_EDILDI,
  BildirimIsDurumu.OKUNDU,
  BildirimIsDurumu.IPTAL_EDILDI
]

export async function openBildirimJobWhatsApp(input: {
  tenantId: string
  userId: string
  jobId: string
  req: Request
  mesaj?: string
}): Promise<Record<string, unknown>> {
  const job = await loadJob(input.tenantId, input.jobId)
  const phone = resolvePhone(job.muvekkil)
  if (!phone) {
    throw new AppError(
      422,
      'Bu müvekkilin telefon numarası kayıtlı değil.',
      'INVALID_PHONE'
    )
  }

  const text = await renderMessageForJob(job, input.mesaj)
  const provider = resolveWhatsAppProvider('MANUAL_WHATSAPP')
  const sendResult = await provider.send({
    tenantId: input.tenantId,
    toE164: phone,
    text,
    idempotencyKey: `open|${job.id}|${Date.now()}`
  })

  if (!TERMINAL_DURUMLAR.includes(job.durum)) {
    await prisma.tahsilatBildirimIsi.update({
      where: { id: job.id },
      data: {
        durum: BildirimIsDurumu.SIMULASYON_TAMAMLANDI,
        telefonMaskeli: maskPhone(phone),
        provider: BildirimProvider.MANUAL_WHATSAPP,
        providerAdi: 'MANUAL_WHATSAPP',
        lockedAt: null,
        lockedBy: null
      }
    })
  }

  const meta = getRequestMeta(input.req)
  await writeAuditLog({
    tenantId: input.tenantId,
    userId: input.userId,
    action: 'TAHSILAT_WHATSAPP_OPENED',
    entityType: 'TahsilatBildirimIsi',
    entityId: job.id,
    newValue: { provider: 'MANUAL_WHATSAPP' },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return {
    ok: true,
    jobId: job.id,
    deepLinkUrl: sendResult.deepLinkUrl,
    telefonMaskeli: maskPhone(phone),
    durum: TERMINAL_DURUMLAR.includes(job.durum) ? job.durum : BildirimIsDurumu.SIMULASYON_TAMAMLANDI
  }
}

/** Cloud API bağlıysa manuel hatırlatmayı gerçek Meta gönderimiyle yapar. */
export async function sendBildirimJobViaCloudApi(input: {
  tenantId: string
  userId: string
  jobId: string
  req: Request
  mesaj?: string
}): Promise<Record<string, unknown>> {
  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId: input.tenantId } })
  if (!baglanti || !isWhatsAppBaglantiConnected(baglanti.durum)) {
    throw new AppError(422, 'WhatsApp Cloud bağlantısı yok.', 'WHATSAPP_NOT_CONNECTED')
  }

  const job = await loadJob(input.tenantId, input.jobId)
  if (TERMINAL_DURUMLAR.includes(job.durum)) {
    return { ok: true, jobId: job.id, durum: job.durum, already: true }
  }

  const phone = resolvePhone(job.muvekkil)
  if (!phone) {
    throw new AppError(422, 'Bu müvekkilin telefon numarası kayıtlı değil.', 'INVALID_PHONE')
  }

  const text = await renderMessageForJob(job, input.mesaj)
  const provider = resolveWhatsAppProvider('WHATSAPP_CLOUD_API')
  const sendResult = await provider.send({
    tenantId: input.tenantId,
    toE164: phone,
    text,
    idempotencyKey: `cloud-manual|${job.id}|${Date.now()}`
  })

  const telefonMaskeli = maskPhone(phone)
  if (!sendResult.ok) {
    await prisma.tahsilatBildirimIsi.update({
      where: { id: job.id },
      data: {
        durum: BildirimIsDurumu.BASARISIZ,
        hataOzeti: sendResult.message.slice(0, 400),
        sonProviderHataKodu: sendResult.code,
        provider: BildirimProvider.WHATSAPP_CLOUD_API,
        providerAdi: 'WHATSAPP_CLOUD_API',
        telefonMaskeli,
        lockedAt: null,
        lockedBy: null
      }
    })
    throw new AppError(502, sendResult.message, sendResult.code)
  }

  await prisma.$transaction([
    prisma.tahsilatBildirimDeneme.create({
      data: {
        tenantId: input.tenantId,
        isId: job.id,
        provider: 'WHATSAPP_CLOUD_API',
        basariliMi: true,
        telefonMaskeli,
        sablonOzeti: null,
        mesajOzeti: 'MASKED',
        sonucKodu: sendResult.code,
        sonucMesaji: sendResult.message
      }
    }),
    prisma.tahsilatBildirimIsi.update({
      where: { id: job.id },
      data: {
        durum: BildirimIsDurumu.GONDERILDI,
        provider: BildirimProvider.WHATSAPP_CLOUD_API,
        providerAdi: 'WHATSAPP_CLOUD_API',
        providerMessageId: sendResult.providerMessageId ?? null,
        telefonMaskeli,
        sonProviderHataKodu: null,
        hataOzeti: null,
        lockedAt: null,
        lockedBy: null,
        denemeSayisi: { increment: 1 },
        sonDenemeAt: new Date()
      }
    })
  ])

  const meta = getRequestMeta(input.req)
  await writeAuditLog({
    tenantId: input.tenantId,
    userId: input.userId,
    action: 'TAHSILAT_WHATSAPP_CLOUD_SENT',
    entityType: 'TahsilatBildirimIsi',
    entityId: job.id,
    newValue: { provider: 'WHATSAPP_CLOUD_API', hasMessageId: Boolean(sendResult.providerMessageId) },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return {
    ok: true,
    jobId: job.id,
    durum: BildirimIsDurumu.GONDERILDI,
    providerMessageId: sendResult.providerMessageId ?? null,
    telefonMaskeli
  }
}

export async function markBildirimJobSent(input: {
  tenantId: string
  userId: string
  jobId: string
  req: Request
}): Promise<Record<string, unknown>> {
  const job = await prisma.tahsilatBildirimIsi.findFirst({
    where: { id: input.jobId, tenantId: input.tenantId }
  })
  if (!job) throw new AppError(404, 'Bildirim kaydı bulunamadı.', 'NOT_FOUND')

  if (TERMINAL_DURUMLAR.includes(job.durum)) {
    return { ok: true, jobId: job.id, durum: job.durum, already: true }
  }

  const allowed: BildirimIsDurumu[] = [
    BildirimIsDurumu.PLANLANDI,
    BildirimIsDurumu.KUYRUKTA,
    BildirimIsDurumu.SIMULASYON_TAMAMLANDI
  ]
  if (!allowed.includes(job.durum)) {
    throw new AppError(422, 'Bu kayıt gönderildi olarak işaretlenemez.', 'INVALID_STATE')
  }

  const updated = await prisma.tahsilatBildirimIsi.update({
    where: { id: job.id },
    data: {
      durum: BildirimIsDurumu.GONDERILDI,
      provider: BildirimProvider.MANUAL_WHATSAPP,
      providerAdi: 'MANUAL_WHATSAPP',
      lockedAt: null,
      lockedBy: null
    }
  })

  const meta = getRequestMeta(input.req)
  await writeAuditLog({
    tenantId: input.tenantId,
    userId: input.userId,
    action: 'TAHSILAT_WHATSAPP_MARK_SENT',
    entityType: 'TahsilatBildirimIsi',
    entityId: job.id,
    newValue: { provider: 'MANUAL_WHATSAPP', manuel: true },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return { ok: true, jobId: updated.id, durum: updated.durum }
}

export async function renderTaksitMessageForManual(
  tenantId: string,
  taksitId: string,
  mesaj?: string
): Promise<{ text: string; kuralTuru: BildirimKuralTuru }> {
  if (mesaj?.trim()) return { text: mesaj.trim(), kuralTuru: BildirimKuralTuru.VADE_GUNU }

  const taksit = await prisma.vekaletTaksiti.findFirst({
    where: { id: taksitId, tenantId },
    include: {
      odemeler: { select: { tutar: true } },
      muvekkil: { select: { gorunenAd: true } },
      dosya: { select: { konuBasligi: true, dosyaNo: true } },
      tenant: { select: { buroAdi: true } }
    }
  })
  if (!taksit) throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')

  const odenen = sumOdeme(taksit.odemeler)
  const kalan = Math.max(0, Number(taksit.tutar) - odenen)
  const built = await buildBildirimMesaji({
    tenantId,
    muvekkilAdi: taksit.muvekkil.gorunenAd,
    buroAdi: taksit.tenant.buroAdi,
    dosyaBaslik: taksit.dosya.konuBasligi,
    dosyaNo: taksit.dosya.dosyaNo,
    vadeTarihi: taksit.vadeTarihi,
    taksitTutari: Number(taksit.tutar),
    odenenTutar: odenen,
    kalanTutar: kalan
  })
  if (!built.ok) {
    throw new AppError(422, `Şablon değişkenleri eksik: ${built.missing.join(', ')}`, 'INVALID_TEMPLATE')
  }
  return { text: built.text, kuralTuru: built.kuralTuru }
}
