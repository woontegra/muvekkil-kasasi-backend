import { BildirimIsDurumu, BildirimKanali, BildirimProvider, Prisma } from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { openBildirimJobWhatsApp, renderTaksitMessageForManual } from './bildirimJobWhatsApp.service.js'
import { buildBildirimMesaji } from './messageTemplate.service.js'
import { maskPhone, normalizeTurkiyePhone } from './phone.js'

function sumOdeme(tutarlar: { tutar: { toString: () => string } }[]): number {
  return tutarlar.reduce((s, o) => s + Number(o.tutar), 0)
}

export async function previewManualWhatsApp(tenantId: string, taksitId: string): Promise<Record<string, unknown>> {
  const taksit = await prisma.vekaletTaksiti.findFirst({
    where: { id: taksitId, tenantId },
    include: {
      odemeler: { select: { tutar: true } },
      muvekkil: { select: { gorunenAd: true, telefon: true, yetkiliTelefon: true } },
      dosya: { select: { konuBasligi: true, dosyaNo: true } },
      tenant: { select: { buroAdi: true } }
    }
  })
  if (!taksit) throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')

  const odenen = sumOdeme(taksit.odemeler)
  const kalan = Math.max(0, Number(taksit.tutar) - odenen)
  const rawPhone = taksit.muvekkil.telefon?.trim() || taksit.muvekkil.yetkiliTelefon?.trim() || ''
  const phone = rawPhone ? normalizeTurkiyePhone(rawPhone) : null

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

  return {
    taksitId,
    muvekkilAdi: taksit.muvekkil.gorunenAd,
    dosyaBilgisi: taksit.dosya.dosyaNo
      ? `${taksit.dosya.konuBasligi} (${taksit.dosya.dosyaNo})`
      : taksit.dosya.konuBasligi,
    kalanTutar: kalan.toFixed(2),
    telefonMaskeli: phone ? maskPhone(phone) : null,
    telefonGecerli: Boolean(phone),
    mesaj: built.text,
    kuralTuru: built.kuralTuru,
    provider: 'MANUAL_WHATSAPP',
    bilgi: 'Hatırlatmalar program tarafından hazırlanır. Gönderim WhatsApp üzerinden sizin tarafınızdan tamamlanır.'
  }
}

export async function prepareManualWhatsApp(input: {
  tenantId: string
  userId: string
  taksitId: string
  mesaj: string
  idempotencyKey: string
  req: Request
}): Promise<Record<string, unknown>> {
  if (!input.idempotencyKey.trim()) {
    throw new AppError(400, 'Idempotency anahtarı zorunludur.', 'IDEMPOTENCY_REQUIRED')
  }
  const text = input.mesaj.trim()
  if (text.length < 10) throw new AppError(422, 'Mesaj metni çok kısa.', 'INVALID_MESSAGE')

  const taksit = await prisma.vekaletTaksiti.findFirst({
    where: { id: input.taksitId, tenantId: input.tenantId },
    include: {
      odemeler: { select: { tutar: true } },
      muvekkil: { select: { gorunenAd: true, telefon: true, yetkiliTelefon: true } }
    }
  })
  if (!taksit) throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')

  const odenen = sumOdeme(taksit.odemeler)
  const kalan = Math.max(0, Number(taksit.tutar) - odenen)
  if (kalan <= 0.001) {
    throw new AppError(422, 'Borcu kapanan taksit için WhatsApp hatırlatması oluşturulamaz.', 'TAKSIT_BORC_YOK')
  }

  const rawPhone = taksit.muvekkil.telefon?.trim() || taksit.muvekkil.yetkiliTelefon?.trim() || ''
  const phone = rawPhone ? normalizeTurkiyePhone(rawPhone) : null
  if (!phone) {
    throw new AppError(422, 'Bu müvekkilin telefon numarası kayıtlı değil.', 'INVALID_PHONE')
  }

  const idemJob = `manual-wa|${input.tenantId}|${input.taksitId}|${input.idempotencyKey}`
  const existing = await prisma.tahsilatBildirimIsi.findUnique({ where: { idempotencyKey: idemJob } })
  if (existing) {
    const opened = await openBildirimJobWhatsApp({
      tenantId: input.tenantId,
      userId: input.userId,
      jobId: existing.id,
      req: input.req,
      mesaj: text
    })
    return { ok: true, status: 'DUPLICATE', ...opened }
  }

  const rendered = await renderTaksitMessageForManual(input.tenantId, input.taksitId, text)

  const job = await prisma.tahsilatBildirimIsi.create({
    data: {
      tenantId: input.tenantId,
      muvekkilId: taksit.muvekkilId,
      dosyaId: taksit.dosyaId,
      taksitId: taksit.id,
      kanal: BildirimKanali.WHATSAPP,
      kuralTuru: rendered.kuralTuru,
      planlananAt: new Date(),
      kalanTutarSnapshot: new Prisma.Decimal(kalan.toFixed(2)),
      durum: BildirimIsDurumu.PLANLANDI,
      idempotencyKey: idemJob,
      manuelTetikleme: true,
      telefonMaskeli: maskPhone(phone),
      provider: BildirimProvider.MANUAL_WHATSAPP,
      providerAdi: 'MANUAL_WHATSAPP',
      providerMessageId: null,
      hataOzeti: null
    }
  })

  const meta = getRequestMeta(input.req)
  await writeAuditLog({
    tenantId: input.tenantId,
    userId: input.userId,
    action: 'TAHSILAT_MANUEL_WHATSAPP_PREPARE',
    entityType: 'TahsilatBildirimIsi',
    entityId: job.id,
    newValue: { provider: 'MANUAL_WHATSAPP' },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  const opened = await openBildirimJobWhatsApp({
    tenantId: input.tenantId,
    userId: input.userId,
    jobId: job.id,
    req: input.req,
    mesaj: text
  })

  return { ok: true, status: 'READY', ...opened }
}
