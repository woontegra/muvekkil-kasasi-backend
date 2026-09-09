/**
 * WhatsApp Cloud API mesaj kredi cüzdanı — tek merkezi servis.
 * Bakiye + hareket aynı transaction; job / lisans dönemi / ödeme idempotent.
 */
import { Prisma, WhatsAppMesajKrediHareketTipi } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { randomUUID } from 'node:crypto'

export const WHATSAPP_KREDI_YETERSIZ = 'KREDI_YETERSIZ' as const

/** Yıllık lisans dönemine dahil edilen ücretsiz mesaj kredisi. */
export const WHATSAPP_YILLIK_DAHIL_KREDI = 500 as const

/** Bu gün ve üzeri uzatma / dönem yıllık sayılır. */
export const WHATSAPP_YILLIK_LISANS_MIN_GUN = 365 as const

export const WHATSAPP_KREDI_DUSUK_ESIK = 100 as const
export const WHATSAPP_KREDI_KRITIK_ESIK = 25 as const

export type WhatsAppKrediDurum = 'NORMAL' | 'DUSUK' | 'KRITIK' | 'TUKENDI'

export type ConsumeCreditResult =
  | { ok: true; alreadyConsumed?: boolean; oncekiBakiye: number; sonrakiBakiye: number }
  | { ok: false; code: typeof WHATSAPP_KREDI_YETERSIZ }

export type RefundCreditResult = {
  ok: true
  alreadyRefunded?: boolean
  noop?: boolean
  oncekiBakiye: number
  sonrakiBakiye: number
}

export type GrantAnnualResult = {
  ok: true
  alreadyGranted?: boolean
  oncekiBakiye: number
  sonrakiBakiye: number
  granted: number
}

export type AddCreditResult = {
  ok: true
  alreadyApplied?: boolean
  oncekiBakiye: number
  sonrakiBakiye: number
}

type Tx = Prisma.TransactionClient

async function lockWalletRow(tx: Tx, tenantId: string): Promise<{ id: string; bakiye: number }> {
  const rows = await tx.$queryRaw<Array<{ id: string; bakiye: number }>>`
    SELECT id, bakiye
    FROM whatsapp_mesaj_kredisi
    WHERE tenant_id = ${tenantId}
    FOR UPDATE
  `
  if (!rows[0]) {
    throw new AppError(500, 'WhatsApp kredi cüzdanı kilitlenemedi.', 'WA_KREDI_WALLET_LOCK')
  }
  return rows[0]
}

export async function ensureWhatsAppMesajKredisi(tenantId: string): Promise<void> {
  await prisma.whatsAppMesajKredisi.upsert({
    where: { tenantId },
    create: { id: randomUUID(), tenantId, bakiye: 0 },
    update: {}
  })
}

export async function getBalance(tenantId: string): Promise<number> {
  await ensureWhatsAppMesajKredisi(tenantId)
  const row = await prisma.whatsAppMesajKredisi.findUniqueOrThrow({
    where: { tenantId },
    select: { bakiye: true }
  })
  return row.bakiye
}

export async function getTransactions(
  tenantId: string,
  opts?: { limit?: number; offset?: number }
): Promise<{
  items: Array<{
    id: string
    tip: WhatsAppMesajKrediHareketTipi
    miktar: number
    oncekiBakiye: number
    sonrakiBakiye: number
    jobId: string | null
    paymentId: string | null
    licensePeriodId: string | null
    aciklama: string | null
    createdAt: Date
  }>
  total: number
}> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200)
  const offset = Math.max(opts?.offset ?? 0, 0)
  const [items, total] = await Promise.all([
    prisma.whatsAppMesajKrediHareketi.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    }),
    prisma.whatsAppMesajKrediHareketi.count({ where: { tenantId } })
  ])
  return { items, total }
}

/**
 * Platform Admin manuel ekleme / düşme.
 * Miktar her zaman pozitif; düşmede hareket `miktar` negatif kaydedilir.
 * Bakiye 0 altına inemez.
 */
export async function adjustManuelCredit(input: {
  tenantId: string
  amount: number
  yon: 'EKLE' | 'DUS'
  aciklama?: string | null
}): Promise<AddCreditResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new AppError(400, 'Kredi miktarı pozitif tam sayı olmalıdır.', 'WA_KREDI_INVALID_AMOUNT')
  }
  if (input.yon !== 'EKLE' && input.yon !== 'DUS') {
    throw new AppError(400, 'Geçersiz işlem yönü.', 'WA_KREDI_INVALID_YON')
  }

  if (input.yon === 'EKLE') {
    return addCredit({
      tenantId: input.tenantId,
      amount: input.amount,
      tip: WhatsAppMesajKrediHareketTipi.MANUEL_DUZELTME,
      aciklama: input.aciklama
    })
  }

  await ensureWhatsAppMesajKredisi(input.tenantId)

  return prisma.$transaction(async (tx) => {
    const wallet = await lockWalletRow(tx, input.tenantId)
    const onceki = wallet.bakiye
    if (onceki < input.amount) {
      throw new AppError(
        422,
        'Bakiye yetersiz; WhatsApp kredisi sıfırın altına düşemez.',
        'WA_KREDI_INSUFFICIENT'
      )
    }
    const sonraki = onceki - input.amount
    await tx.whatsAppMesajKredisi.update({
      where: { tenantId: input.tenantId },
      data: { bakiye: sonraki }
    })
    await tx.whatsAppMesajKrediHareketi.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        tip: WhatsAppMesajKrediHareketTipi.MANUEL_DUZELTME,
        miktar: -input.amount,
        oncekiBakiye: onceki,
        sonrakiBakiye: sonraki,
        aciklama: input.aciklama?.trim() || null
      }
    })
    return { ok: true as const, oncekiBakiye: onceki, sonrakiBakiye: sonraki }
  })
}

export type AddCreditInput = {
  tenantId: string
  amount: number
  tip: Extract<
    WhatsAppMesajKrediHareketTipi,
    'PAKET_SATIN_ALMA' | 'MANUEL_DUZELTME' | 'YILLIK_DAHIL'
  >
  paymentId?: string | null
  licensePeriodId?: string | null
  aciklama?: string | null
}

function assertAddCreditInput(input: AddCreditInput): void {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new AppError(400, 'Kredi miktarı pozitif tam sayı olmalıdır.', 'WA_KREDI_INVALID_AMOUNT')
  }
  if (input.tip === 'PAKET_SATIN_ALMA' && !input.paymentId?.trim()) {
    throw new AppError(400, 'Paket satın alma için paymentId zorunludur.', 'WA_KREDI_PAYMENT_REQUIRED')
  }
  if (input.tip === 'YILLIK_DAHIL' && !input.licensePeriodId?.trim()) {
    throw new AppError(400, 'Yıllık dahil kredi için licensePeriodId zorunludur.', 'WA_KREDI_LICENSE_REQUIRED')
  }
}

/**
 * Mevcut transaction içinde kredi ekler (talep onayı ile atomik kullanım için).
 * paymentId / licensePeriodId idempotent.
 */
export async function addCreditInTx(tx: Tx, input: AddCreditInput): Promise<AddCreditResult> {
  assertAddCreditInput(input)
  const paymentId = input.paymentId?.trim() || null
  const licensePeriodId = input.licensePeriodId?.trim() || null

  if (input.tip === 'PAKET_SATIN_ALMA' && paymentId) {
    const existing = await tx.whatsAppMesajKrediHareketi.findFirst({
      where: {
        tenantId: input.tenantId,
        tip: WhatsAppMesajKrediHareketTipi.PAKET_SATIN_ALMA,
        paymentId
      },
      select: { id: true, oncekiBakiye: true, sonrakiBakiye: true }
    })
    if (existing) {
      const bal = await tx.whatsAppMesajKredisi.findUnique({
        where: { tenantId: input.tenantId },
        select: { bakiye: true }
      })
      const b = bal?.bakiye ?? existing.sonrakiBakiye
      return {
        ok: true,
        alreadyApplied: true,
        oncekiBakiye: b,
        sonrakiBakiye: b
      }
    }
  }

  if (input.tip === 'YILLIK_DAHIL' && licensePeriodId) {
    const existing = await tx.whatsAppMesajKrediHareketi.findFirst({
      where: {
        tenantId: input.tenantId,
        tip: WhatsAppMesajKrediHareketTipi.YILLIK_DAHIL,
        licensePeriodId
      },
      select: { id: true, sonrakiBakiye: true }
    })
    if (existing) {
      const bal = await tx.whatsAppMesajKredisi.findUnique({
        where: { tenantId: input.tenantId },
        select: { bakiye: true }
      })
      const b = bal?.bakiye ?? existing.sonrakiBakiye
      return {
        ok: true,
        alreadyApplied: true,
        oncekiBakiye: b,
        sonrakiBakiye: b
      }
    }
  }

  const wallet = await lockWalletRow(tx, input.tenantId)
  const onceki = wallet.bakiye
  const sonraki = onceki + input.amount
  await tx.whatsAppMesajKredisi.update({
    where: { tenantId: input.tenantId },
    data: { bakiye: sonraki }
  })
  await tx.whatsAppMesajKrediHareketi.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      tip: input.tip,
      miktar: input.amount,
      oncekiBakiye: onceki,
      sonrakiBakiye: sonraki,
      paymentId,
      licensePeriodId,
      aciklama: input.aciklama?.trim() || null
    }
  })
  return { ok: true as const, oncekiBakiye: onceki, sonrakiBakiye: sonraki }
}

/**
 * Satın alınan / manuel ekleme. paymentId verilirse aynı ödeme ikinci kez eklenmez.
 */
export async function addCredit(input: AddCreditInput): Promise<AddCreditResult> {
  assertAddCreditInput(input)
  await ensureWhatsAppMesajKredisi(input.tenantId)

  try {
    return await prisma.$transaction(async (tx) => addCreditInTx(tx, input))
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const bal = await getBalance(input.tenantId)
      return {
        ok: true,
        alreadyApplied: true,
        oncekiBakiye: bal,
        sonrakiBakiye: bal
      }
    }
    throw err
  }
}

/**
 * Lisans aktivasyonu / yenilemesi için yıllık dahil krediler.
 * Aynı licensePeriodId ile ikinci kez verilmez.
 */
export async function grantAnnualIncludedCredits(
  tenantId: string,
  licensePeriodId: string,
  amount = 500
): Promise<GrantAnnualResult> {
  const period = licensePeriodId.trim()
  if (!period) {
    throw new AppError(400, 'licensePeriodId zorunludur.', 'WA_KREDI_LICENSE_REQUIRED')
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError(400, 'Yıllık kredi miktarı pozitif tam sayı olmalıdır.', 'WA_KREDI_INVALID_AMOUNT')
  }

  const res = await addCredit({
    tenantId,
    amount,
    tip: WhatsAppMesajKrediHareketTipi.YILLIK_DAHIL,
    licensePeriodId: period,
    aciklama: `Yıllık lisans dahil WhatsApp kredisi (${amount})`
  })

  return {
    ok: true,
    alreadyGranted: Boolean(res.alreadyApplied),
    oncekiBakiye: res.oncekiBakiye,
    sonrakiBakiye: res.sonrakiBakiye,
    granted: res.alreadyApplied ? 0 : amount
  }
}

/**
 * Otomatik Cloud gönderim öncesi 1 kredi düşer (idempotent: aynı jobId yalnız bir kez).
 */
export async function consumeForJob(tenantId: string, jobId: string): Promise<ConsumeCreditResult> {
  const jid = jobId.trim()
  if (!jid) {
    throw new AppError(400, 'jobId zorunludur.', 'WA_KREDI_JOB_REQUIRED')
  }

  await ensureWhatsAppMesajKredisi(tenantId)

  try {
    return await prisma.$transaction(async (tx) => {
      const wallet = await lockWalletRow(tx, tenantId)

      const existing = await tx.whatsAppMesajKrediHareketi.findUnique({
        where: {
          jobId_tip: { jobId: jid, tip: WhatsAppMesajKrediHareketTipi.MESAJ_GONDERIM }
        }
      })
      if (existing) {
        return {
          ok: true as const,
          alreadyConsumed: true,
          oncekiBakiye: existing.oncekiBakiye,
          sonrakiBakiye: existing.sonrakiBakiye
        }
      }

      if (wallet.bakiye < 1) {
        return { ok: false as const, code: WHATSAPP_KREDI_YETERSIZ }
      }

      const onceki = wallet.bakiye
      const sonraki = onceki - 1
      await tx.whatsAppMesajKredisi.update({
        where: { tenantId },
        data: { bakiye: sonraki }
      })
      await tx.whatsAppMesajKrediHareketi.create({
        data: {
          id: randomUUID(),
          tenantId,
          tip: WhatsAppMesajKrediHareketTipi.MESAJ_GONDERIM,
          miktar: -1,
          oncekiBakiye: onceki,
          sonrakiBakiye: sonraki,
          jobId: jid,
          aciklama: 'Otomatik WhatsApp Cloud gönderim'
        }
      })
      return { ok: true as const, oncekiBakiye: onceki, sonrakiBakiye: sonraki }
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.whatsAppMesajKrediHareketi.findUnique({
        where: {
          jobId_tip: { jobId: jid, tip: WhatsAppMesajKrediHareketTipi.MESAJ_GONDERIM }
        }
      })
      if (existing) {
        return {
          ok: true,
          alreadyConsumed: true,
          oncekiBakiye: existing.oncekiBakiye,
          sonrakiBakiye: existing.sonrakiBakiye
        }
      }
    }
    throw err
  }
}

/**
 * Meta senkron hata / API request başarısız → aynı job için 1 kredi iade (idempotent).
 */
export async function refundForJob(
  tenantId: string,
  jobId: string,
  aciklama?: string
): Promise<RefundCreditResult> {
  const jid = jobId.trim()
  if (!jid) {
    throw new AppError(400, 'jobId zorunludur.', 'WA_KREDI_JOB_REQUIRED')
  }

  await ensureWhatsAppMesajKredisi(tenantId)

  try {
    return await prisma.$transaction(async (tx) => {
      const already = await tx.whatsAppMesajKrediHareketi.findUnique({
        where: {
          jobId_tip: { jobId: jid, tip: WhatsAppMesajKrediHareketTipi.IADE }
        }
      })
      if (already) {
        return {
          ok: true as const,
          alreadyRefunded: true,
          oncekiBakiye: already.oncekiBakiye,
          sonrakiBakiye: already.sonrakiBakiye
        }
      }

      const consumed = await tx.whatsAppMesajKrediHareketi.findUnique({
        where: {
          jobId_tip: { jobId: jid, tip: WhatsAppMesajKrediHareketTipi.MESAJ_GONDERIM }
        }
      })
      if (!consumed) {
        const wallet = await lockWalletRow(tx, tenantId)
        return {
          ok: true as const,
          noop: true,
          oncekiBakiye: wallet.bakiye,
          sonrakiBakiye: wallet.bakiye
        }
      }

      const wallet = await lockWalletRow(tx, tenantId)
      const onceki = wallet.bakiye
      const sonraki = onceki + 1
      await tx.whatsAppMesajKredisi.update({
        where: { tenantId },
        data: { bakiye: sonraki }
      })
      await tx.whatsAppMesajKrediHareketi.create({
        data: {
          id: randomUUID(),
          tenantId,
          tip: WhatsAppMesajKrediHareketTipi.IADE,
          miktar: 1,
          oncekiBakiye: onceki,
          sonrakiBakiye: sonraki,
          jobId: jid,
          aciklama: aciklama?.trim() || 'Meta gönderim hatası — kredi iadesi'
        }
      })
      return { ok: true as const, oncekiBakiye: onceki, sonrakiBakiye: sonraki }
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const already = await prisma.whatsAppMesajKrediHareketi.findUnique({
        where: {
          jobId_tip: { jobId: jid, tip: WhatsAppMesajKrediHareketTipi.IADE }
        }
      })
      if (already) {
        return {
          ok: true,
          alreadyRefunded: true,
          oncekiBakiye: already.oncekiBakiye,
          sonrakiBakiye: already.sonrakiBakiye
        }
      }
    }
    throw err
  }
}

export function resolveWhatsAppKrediDurum(bakiye: number): WhatsAppKrediDurum {
  if (bakiye <= 0) return 'TUKENDI'
  if (bakiye <= WHATSAPP_KREDI_KRITIK_ESIK) return 'KRITIK'
  if (bakiye <= WHATSAPP_KREDI_DUSUK_ESIK) return 'DUSUK'
  return 'NORMAL'
}

/**
 * Yıllık dahil kredi verilmeli mi?
 * Demo / aylık / kısa paketler → hayır. YILLIK paket veya ≥365 gün → evet.
 */
export function isEligibleForAnnualWhatsAppCredits(input: {
  demoMu?: boolean | null
  lisansDurumu?: string | null
  renewalDays?: number | null
  lisansPaketi?: string | null
}): boolean {
  if (input.demoMu === true || input.lisansDurumu === 'DEMO') return false
  const paket = input.lisansPaketi?.trim().toUpperCase() || null
  if (paket === 'DEMO' || paket === 'AYLIK' || paket === 'UC_AY' || paket === 'ALTI_AY') {
    return false
  }
  if (paket === 'YILLIK') return true
  const days = input.renewalDays ?? 0
  return Number.isFinite(days) && days >= WHATSAPP_YILLIK_LISANS_MIN_GUN
}

/**
 * Lisans aktivasyonu / yenileme sonrası çağrılır (yalnız server-side).
 * Uygun değilse no-op; aynı licensePeriodId ikinci kez +0.
 */
export async function tryGrantAnnualIncludedCreditsAfterLicensePeriod(input: {
  tenantId: string
  licensePeriodId: string
  demoMu?: boolean | null
  lisansDurumu?: string | null
  renewalDays?: number | null
  lisansPaketi?: string | null
  amount?: number
}): Promise<GrantAnnualResult | { ok: true; skipped: true; reason: 'NOT_ELIGIBLE' }> {
  if (
    !isEligibleForAnnualWhatsAppCredits({
      demoMu: input.demoMu,
      lisansDurumu: input.lisansDurumu,
      renewalDays: input.renewalDays,
      lisansPaketi: input.lisansPaketi
    })
  ) {
    return { ok: true, skipped: true, reason: 'NOT_ELIGIBLE' }
  }
  return grantAnnualIncludedCredits(
    input.tenantId,
    input.licensePeriodId,
    input.amount ?? WHATSAPP_YILLIK_DAHIL_KREDI
  )
}

export type WhatsAppMesajKrediOzet = {
  bakiye: number
  toplamKullanilan: number
  toplamEklenen: number
  durum: WhatsAppKrediDurum
  dusukBakiye: boolean
  kritikBakiye: boolean
  yillikDahilKredi: number
}

export async function getWhatsAppMesajKrediOzet(tenantId: string): Promise<WhatsAppMesajKrediOzet> {
  await ensureWhatsAppMesajKredisi(tenantId)
  const [wallet, eklenenAgg, kullanilanAgg] = await Promise.all([
    prisma.whatsAppMesajKredisi.findUniqueOrThrow({
      where: { tenantId },
      select: { bakiye: true }
    }),
    prisma.whatsAppMesajKrediHareketi.aggregate({
      where: {
        tenantId,
        tip: {
          in: [
            WhatsAppMesajKrediHareketTipi.YILLIK_DAHIL,
            WhatsAppMesajKrediHareketTipi.PAKET_SATIN_ALMA,
            WhatsAppMesajKrediHareketTipi.MANUEL_DUZELTME
          ]
        },
        miktar: { gt: 0 }
      },
      _sum: { miktar: true }
    }),
    prisma.whatsAppMesajKrediHareketi.aggregate({
      where: { tenantId, tip: WhatsAppMesajKrediHareketTipi.MESAJ_GONDERIM },
      _sum: { miktar: true }
    })
  ])

  const toplamEklenen = eklenenAgg._sum.miktar ?? 0
  const toplamKullanilan = Math.abs(kullanilanAgg._sum.miktar ?? 0)

  const bakiye = wallet.bakiye
  const durum = resolveWhatsAppKrediDurum(bakiye)
  return {
    bakiye,
    toplamKullanilan,
    toplamEklenen,
    durum,
    dusukBakiye: durum === 'DUSUK' || durum === 'KRITIK' || durum === 'TUKENDI',
    kritikBakiye: durum === 'KRITIK' || durum === 'TUKENDI',
    yillikDahilKredi: WHATSAPP_YILLIK_DAHIL_KREDI
  }
}
