import { BildirimIsDurumu, BildirimKanali, BildirimKuralTuru, Prisma, VekaletTaksitOdemeDurumu } from '@prisma/client'
import { env } from '../config/env.js'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { maskPhone, normalizeTurkiyePhone } from '../tahsilatBildirim/phone.js'
import { getSmsProvider } from '../tahsilatBildirim/providers/smsProvider.js'
import { calculateSmsParts } from '../tahsilatBildirim/smsParts.js'
import { consumeReservedSmsCredit, ensureSmsWallet, releaseReservedSmsCredit, reserveSmsCredit } from '../tahsilatBildirim/smsWallet.service.js'
import { renderTemplate } from '../tahsilatBildirim/templates.js'
import type { Request } from 'express'

function fmtMoney(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function fmtVadeTr(d: Date): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d)
  const [y, m, day] = ymd.split('-')
  return `${day}.${m}.${y}`
}

function dosyaBilgisi(konu: string, dosyaNo: string | null): string {
  return dosyaNo ? `${konu} (${dosyaNo})` : konu
}

export async function getManualSmsPreview(tenantId: string, taksitId: string): Promise<Record<string, unknown>> {
  await ensureSmsWallet(tenantId)
  const [taksit, wallet] = await Promise.all([
    prisma.vekaletTaksiti.findFirst({
      where: { id: taksitId, tenantId },
      include: {
        odemeler: { select: { tutar: true } },
        muvekkil: { select: { gorunenAd: true, telefon: true, yetkiliTelefon: true } },
        dosya: { select: { konuBasligi: true, dosyaNo: true } },
        tenant: { select: { buroAdi: true } }
      }
    }),
    prisma.smsTenantBakiye.findUnique({ where: { tenantId } })
  ])
  if (!taksit) throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')

  const odenen = taksit.odemeler.reduce((s, o) => s + Number(o.tutar), 0)
  const kalan = Math.max(0, Number(taksit.tutar) - odenen)
  const telefon = normalizeTurkiyePhone(taksit.muvekkil.telefon ?? taksit.muvekkil.yetkiliTelefon ?? '')
  const metinTpl =
    (
      await prisma.tahsilatBildirimSablonu.findFirst({
        where: { tenantId, kanal: BildirimKanali.SMS, kuralTuru: BildirimKuralTuru.VADE_GUNU }
      })
    )?.metin ??
    'Sayın {muvekkilAdi}, {dosyaBilgisi} kapsamındaki {vadeTarihi} vadeli vekalet ücreti taksidinizden kalan {kalanTutar} TL bulunmaktadır. Bilginize sunarız. {buroAdi}'

  const rendered = renderTemplate(metinTpl, {
    muvekkilAdi: taksit.muvekkil.gorunenAd,
    dosyaBilgisi: dosyaBilgisi(taksit.dosya.konuBasligi, taksit.dosya.dosyaNo),
    vadeTarihi: fmtVadeTr(taksit.vadeTarihi),
    kalanTutar: fmtMoney(kalan),
    gecikmeGunu: '0',
    taksitTutari: fmtMoney(Number(taksit.tutar)),
    odenenTutar: fmtMoney(odenen),
    buroAdi: taksit.tenant.buroAdi
  })
  if (!rendered.ok) {
    throw new AppError(422, 'Mesaj şablonu eksik değişken içeriyor.', 'INVALID_TEMPLATE')
  }
  const sms = calculateSmsParts(rendered.text, 'TR')
  const bakiye = wallet?.mevcutBakiye ?? 0
  return {
    taksitId,
    muvekkilAdi: taksit.muvekkil.gorunenAd,
    dosyaBilgisi: dosyaBilgisi(taksit.dosya.konuBasligi, taksit.dosya.dosyaNo),
    vadeTarihi: fmtVadeTr(taksit.vadeTarihi),
    kalanTutar: fmtMoney(kalan),
    telefonMaskeli: telefon ? maskPhone(telefon) : null,
    mesaj: rendered.text,
    smsParcaSayisi: sms.parts,
    smsKrediTuketimi: sms.parts,
    bakiye,
    bakiyeSonrasiTahmini: bakiye - sms.parts,
    testModu: !env.NETGSM_ENABLED
  }
}

export async function sendManualSms(input: {
  tenantId: string
  userId: string
  taksitId: string
  mesaj: string
  idempotencyKey: string
  req: Request
}): Promise<Record<string, unknown>> {
  if (!input.idempotencyKey.trim()) throw new AppError(400, 'Idempotency anahtarı zorunludur.', 'IDEMPOTENCY_REQUIRED')
  const taksit = await prisma.vekaletTaksiti.findFirst({
    where: { id: input.taksitId, tenantId: input.tenantId },
    include: {
      odemeler: { select: { tutar: true } },
      muvekkil: { select: { gorunenAd: true, telefon: true, yetkiliTelefon: true, otomatikBildirimIzni: true } },
      dosya: { select: { konuBasligi: true, dosyaNo: true, otomatikBildirimAktif: true } },
      tenant: { select: { buroAdi: true } }
    }
  })
  if (!taksit) throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')
  if (taksit.odemeDurumu === VekaletTaksitOdemeDurumu.IPTAL) throw new AppError(422, 'İptal takside SMS gönderilemez.', 'TAKSIT_IPTAL')

  const odenen = taksit.odemeler.reduce((s, o) => s + Number(o.tutar), 0)
  const kalan = Math.max(0, Number(taksit.tutar) - odenen)
  if (kalan <= 0.001) throw new AppError(422, 'Borcu kapanan takside SMS gönderilemez.', 'TAKSIT_BORC_YOK')

  const to = normalizeTurkiyePhone(taksit.muvekkil.telefon ?? taksit.muvekkil.yetkiliTelefon ?? '')
  if (!to) throw new AppError(422, 'Geçerli telefon numarası bulunamadı.', 'INVALID_PHONE')
  const text = input.mesaj.trim()
  if (text.length < 10) throw new AppError(422, 'SMS metni çok kısa.', 'INVALID_MESSAGE')

  await ensureSmsWallet(input.tenantId)
  const sms = calculateSmsParts(text, 'TR')
  const reserve = await reserveSmsCredit({
    tenantId: input.tenantId,
    bildirimIsiId: undefined,
    amount: sms.parts,
    idempotencyKey: `manual:reserve:${input.idempotencyKey}`
  })
  if (!reserve.ok) {
    throw new AppError(422, 'SMS bakiyesi yetersiz.', 'SMS_BAKIYE_YETERSIZ')
  }

  const idemJob = `manual|${input.tenantId}|${input.taksitId}|${input.idempotencyKey}`
  const existing = await prisma.tahsilatBildirimIsi.findUnique({ where: { idempotencyKey: idemJob } })
  if (existing) {
    return { ok: true, status: 'DUPLICATE', jobId: existing.id }
  }

  const provider = getSmsProvider(!env.NETGSM_ENABLED)
  const sendResult = await provider.send({
    tenantId: input.tenantId,
    to,
    text,
    idempotencyKey: idemJob
  })

  const job = await prisma.tahsilatBildirimIsi.create({
    data: {
      tenantId: input.tenantId,
      muvekkilId: taksit.muvekkilId,
      dosyaId: taksit.dosyaId,
      taksitId: taksit.id,
      kanal: BildirimKanali.SMS,
      kuralTuru: BildirimKuralTuru.VADE_GUNU,
      planlananAt: new Date(),
      kalanTutarSnapshot: new Prisma.Decimal(kalan.toFixed(2)),
      durum: sendResult.ok ? (sendResult.provider === 'MOCK' ? BildirimIsDurumu.SIMULASYON_TAMAMLANDI : BildirimIsDurumu.GONDERILDI) : BildirimIsDurumu.BASARISIZ,
      idempotencyKey: idemJob,
      manuelTetikleme: true,
      smsParcaSayisi: sms.parts,
      smsKrediTuketimi: sendResult.ok ? sms.parts : 0,
      telefonMaskeli: maskPhone(to),
      providerAdi: sendResult.provider,
      providerBulkId: sendResult.providerBulkId ?? null,
      providerMessageId: sendResult.providerMessageId ?? null,
      sonProviderHataKodu: sendResult.ok ? null : sendResult.code,
      hataOzeti: sendResult.ok ? null : sendResult.message
    }
  })

  if (sendResult.ok) {
    await consumeReservedSmsCredit({
      tenantId: input.tenantId,
      bildirimIsiId: job.id,
      amount: sms.parts,
      idempotencyKey: `manual:consume:${input.idempotencyKey}`
    })
  } else {
    await releaseReservedSmsCredit({
      tenantId: input.tenantId,
      bildirimIsiId: job.id,
      amount: sms.parts,
      idempotencyKey: `manual:release:${input.idempotencyKey}:${sendResult.code}`
    })
  }

  const meta = getRequestMeta(input.req)
  await writeAuditLog({
    tenantId: input.tenantId,
    userId: input.userId,
    action: 'TAHSILAT_MANUEL_SMS_SEND',
    entityType: 'TahsilatBildirimIsi',
    entityId: job.id,
    newValue: {
      smsKrediTuketimi: sendResult.ok ? sms.parts : 0,
      sonuc: sendResult.ok ? 'OK' : 'FAILED',
      provider: sendResult.provider
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return { ok: true, status: sendResult.ok ? 'SENT' : 'FAILED', jobId: job.id, message: sendResult.message }
}
