import { BildirimIsDurumu, BildirimKanali, BildirimKuralTuru, Prisma } from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { buildBildirimMesaji } from './messageTemplate.service.js'
import { maskPhone, normalizeTurkiyePhone } from './phone.js'
import { resolveWhatsAppProvider } from './providers/whatsappProvider.js'

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
    vadeTarihi: built.text.includes('.') ? undefined : undefined,
    kalanTutar: kalan.toFixed(2),
    telefonMaskeli: phone ? maskPhone(phone) : null,
    telefonGecerli: Boolean(phone),
    mesaj: built.text,
    kuralTuru: built.kuralTuru,
    provider: 'MANUAL_WHATSAPP',
    bilgi: 'Bildirimler WhatsApp üzerinden, kendi WhatsApp hesabınız kullanılarak gönderilir.'
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
      muvekkil: { select: { gorunenAd: true, telefon: true, yetkiliTelefon: true } },
      dosya: { select: { konuBasligi: true, dosyaNo: true } }
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
    throw new AppError(
      422,
      'Geçerli bir Türkiye cep telefonu bulunamadı. Müvekkil iletişim bilgilerini güncelleyin.',
      'INVALID_PHONE'
    )
  }

  const idemJob = `manual-wa|${input.tenantId}|${input.taksitId}|${input.idempotencyKey}`
  const existing = await prisma.tahsilatBildirimIsi.findUnique({ where: { idempotencyKey: idemJob } })
  if (existing) {
    const provider = resolveWhatsAppProvider('MANUAL_WHATSAPP')
    const again = await provider.send({
      tenantId: input.tenantId,
      toE164: phone,
      text,
      idempotencyKey: idemJob
    })
    return {
      ok: true,
      status: 'DUPLICATE',
      jobId: existing.id,
      deepLinkUrl: again.deepLinkUrl,
      telefonMaskeli: maskPhone(phone)
    }
  }

  const provider = resolveWhatsAppProvider('MANUAL_WHATSAPP')
  const sendResult = await provider.send({
    tenantId: input.tenantId,
    toE164: phone,
    text,
    idempotencyKey: idemJob
  })

  const job = await prisma.tahsilatBildirimIsi.create({
    data: {
      tenantId: input.tenantId,
      muvekkilId: taksit.muvekkilId,
      dosyaId: taksit.dosyaId,
      taksitId: taksit.id,
      kanal: BildirimKanali.WHATSAPP,
      kuralTuru: BildirimKuralTuru.VADE_GUNU,
      planlananAt: new Date(),
      kalanTutarSnapshot: new Prisma.Decimal(kalan.toFixed(2)),
      durum: BildirimIsDurumu.SIMULASYON_TAMAMLANDI,
      idempotencyKey: idemJob,
      manuelTetikleme: true,
      telefonMaskeli: maskPhone(phone),
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
    newValue: {
      provider: 'MANUAL_WHATSAPP',
      sonuc: sendResult.ok ? 'READY' : 'FAILED'
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return {
    ok: true,
    status: 'READY',
    jobId: job.id,
    deepLinkUrl: sendResult.deepLinkUrl,
    telefonMaskeli: maskPhone(phone),
    message: sendResult.message
  }
}
