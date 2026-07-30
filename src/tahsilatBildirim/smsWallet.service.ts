import { Prisma, SmsKrediHareketTuru } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'

export async function ensureSmsWallet(tenantId: string): Promise<void> {
  await prisma.smsTenantBakiye.upsert({
    where: { tenantId },
    create: { tenantId },
    update: {}
  })
}

export async function reserveSmsCredit(input: {
  tenantId: string
  bildirimIsiId?: string
  amount: number
  idempotencyKey: string
}): Promise<{ ok: boolean; reason?: 'INSUFFICIENT_BALANCE' }> {
  if (input.amount <= 0) return { ok: true }
  try {
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.smsTenantBakiye.findUniqueOrThrow({
        where: { tenantId: input.tenantId }
      })
      const exists = await tx.smsKrediHareketi.findFirst({
        where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey }
      })
      if (exists) return
      if (wallet.mevcutBakiye < input.amount) {
        throw new AppError(422, 'SMS bakiyesi yetersiz.', 'SMS_BAKIYE_YETERSIZ')
      }
      const sonraki = wallet.mevcutBakiye - input.amount
      await tx.smsTenantBakiye.update({
        where: { tenantId: input.tenantId },
        data: { mevcutBakiye: sonraki }
      })
      await tx.smsKrediHareketi.create({
        data: {
          tenantId: input.tenantId,
          bildirimIsiId: input.bildirimIsiId ?? null,
          tur: SmsKrediHareketTuru.REZERVE,
          miktar: input.amount,
          oncekiBakiye: wallet.mevcutBakiye,
          sonrakiBakiye: sonraki,
          idempotencyKey: input.idempotencyKey
        }
      })
    })
    return { ok: true }
  } catch (err) {
    if (err instanceof AppError && err.code === 'SMS_BAKIYE_YETERSIZ') {
      return { ok: false, reason: 'INSUFFICIENT_BALANCE' }
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: true }
    }
    throw err
  }
}

async function applyCreditLedger(input: {
  tenantId: string
  bildirimIsiId?: string
  amount: number
  idempotencyKey: string
  tur: SmsKrediHareketTuru
  walletDelta: number
}): Promise<void> {
  if (input.amount <= 0) return
  await prisma.$transaction(async (tx) => {
    const wallet = await tx.smsTenantBakiye.findUniqueOrThrow({
      where: { tenantId: input.tenantId }
    })
    const exists = await tx.smsKrediHareketi.findFirst({
      where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey }
    })
    if (exists) return

    const sonraki = wallet.mevcutBakiye + input.walletDelta
    if (sonraki < 0) {
      throw new AppError(422, 'SMS bakiyesi eksiye düşemez.', 'SMS_NEGATIVE_BALANCE')
    }
    await tx.smsTenantBakiye.update({
      where: { tenantId: input.tenantId },
      data: {
        mevcutBakiye: sonraki,
        toplamTuketilen:
          input.tur === SmsKrediHareketTuru.TUKETIM ? { increment: input.amount } : undefined,
        toplamIadeEdilen:
          input.tur === SmsKrediHareketTuru.IADE ? { increment: input.amount } : undefined
      }
    })
    await tx.smsKrediHareketi.create({
      data: {
        tenantId: input.tenantId,
        bildirimIsiId: input.bildirimIsiId ?? null,
        tur: input.tur,
        miktar: input.amount,
        oncekiBakiye: wallet.mevcutBakiye,
        sonrakiBakiye: sonraki,
        idempotencyKey: input.idempotencyKey
      }
    })
  })
}

export async function consumeReservedSmsCredit(input: {
  tenantId: string
  bildirimIsiId?: string
  amount: number
  idempotencyKey: string
}): Promise<void> {
  await applyCreditLedger({
    ...input,
    tur: SmsKrediHareketTuru.TUKETIM,
    walletDelta: 0
  })
}

export async function releaseReservedSmsCredit(input: {
  tenantId: string
  bildirimIsiId?: string
  amount: number
  idempotencyKey: string
}): Promise<void> {
  await applyCreditLedger({
    ...input,
    tur: SmsKrediHareketTuru.REZERV_IPTALI,
    walletDelta: input.amount
  })
}

export async function refundSmsCredit(input: {
  tenantId: string
  bildirimIsiId?: string
  amount: number
  idempotencyKey: string
}): Promise<void> {
  await applyCreditLedger({
    ...input,
    tur: SmsKrediHareketTuru.IADE,
    walletDelta: input.amount
  })
}
