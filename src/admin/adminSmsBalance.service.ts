import { Prisma, SmsKrediHareketTuru } from '@prisma/client'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { ensureSmsWallet } from '../tahsilatBildirim/smsWallet.service.js'
import { writeAdminAuditLog } from './adminAudit.service.js'

export async function getTenantSmsBalanceAdmin(tenantId: string): Promise<Record<string, unknown>> {
  await ensureSmsWallet(tenantId)
  const [wallet, rezervToplam, recent] = await Promise.all([
    prisma.smsTenantBakiye.findUniqueOrThrow({ where: { tenantId } }),
    prisma.smsKrediHareketi.aggregate({
      where: { tenantId, tur: SmsKrediHareketTuru.REZERVE },
      _sum: { miktar: true }
    }),
    prisma.smsKrediHareketi.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 25
    })
  ])
  return {
    mevcutBakiye: wallet.mevcutBakiye,
    rezerveEdilmis: rezervToplam._sum.miktar ?? 0,
    toplamYuklenen: wallet.toplamYuklenen,
    toplamTuketilen: wallet.toplamTuketilen,
    toplamIadeEdilen: wallet.toplamIadeEdilen,
    hareketler: recent.map((h) => ({
      id: h.id,
      tur: h.tur,
      miktar: h.miktar,
      oncekiBakiye: h.oncekiBakiye,
      sonrakiBakiye: h.sonrakiBakiye,
      aciklama: h.aciklama ?? null,
      createdAt: h.createdAt.toISOString()
    }))
  }
}

export async function adjustTenantSmsBalanceAdmin(input: {
  tenantId: string
  adminId: string
  req: Request
  islemTuru: 'YUKLE' | 'DUZELTME' | 'DUS'
  miktar: number
  aciklama: string
  idempotencyKey: string
}): Promise<Record<string, unknown>> {
  if (!input.idempotencyKey.trim()) {
    throw new AppError(400, 'Idempotency anahtarı zorunludur.', 'IDEMPOTENCY_REQUIRED')
  }
  if (!Number.isFinite(input.miktar) || input.miktar <= 0) {
    throw new AppError(400, 'Miktar pozitif olmalıdır.', 'INVALID_AMOUNT')
  }
  if (!input.aciklama.trim()) {
    throw new AppError(400, 'Açıklama zorunludur.', 'NOTE_REQUIRED')
  }

  await ensureSmsWallet(input.tenantId)
  const meta = getRequestMeta(input.req)

  const out = await prisma.$transaction(async (tx) => {
    const wallet = await tx.smsTenantBakiye.findUniqueOrThrow({ where: { tenantId: input.tenantId } })
    const idem = `admin:${input.idempotencyKey.trim()}`
    const existing = await tx.smsKrediHareketi.findFirst({
      where: { tenantId: input.tenantId, idempotencyKey: idem }
    })
    if (existing) {
      return { mevcutBakiye: wallet.mevcutBakiye, oncekiBakiye: existing.oncekiBakiye, sonrakiBakiye: existing.sonrakiBakiye, tekrar: true }
    }

    const delta = input.islemTuru === 'DUS' ? -input.miktar : input.miktar
    const sonraki = wallet.mevcutBakiye + delta
    if (sonraki < 0) {
      throw new AppError(422, 'Bakiye sıfırın altına düşemez.', 'NEGATIVE_BALANCE')
    }

    await tx.smsTenantBakiye.update({
      where: { tenantId: input.tenantId },
      data: {
        mevcutBakiye: sonraki,
        toplamYuklenen:
          input.islemTuru === 'YUKLE' ? { increment: input.miktar } : undefined
      }
    })
    await tx.smsKrediHareketi.create({
      data: {
        tenantId: input.tenantId,
        tur: input.islemTuru === 'YUKLE' ? SmsKrediHareketTuru.MANUEL_YUKLEME : SmsKrediHareketTuru.DUZELTME,
        miktar: Math.abs(delta),
        oncekiBakiye: wallet.mevcutBakiye,
        sonrakiBakiye: sonraki,
        idempotencyKey: idem,
        aciklama: input.aciklama.trim(),
        olusturanAdminId: input.adminId
      }
    })
    return { mevcutBakiye: sonraki, oncekiBakiye: wallet.mevcutBakiye, sonrakiBakiye: sonraki, tekrar: false }
  })

  await writeAdminAuditLog({
    adminId: input.adminId,
    action: 'TENANT_SMS_BALANCE_ADJUSTED',
    entityType: 'SmsTenantBakiye',
    entityId: input.tenantId,
    newValue: {
      islemTuru: input.islemTuru,
      miktar: input.miktar,
      aciklama: input.aciklama.trim(),
      oncekiBakiye: out.oncekiBakiye,
      sonrakiBakiye: out.sonrakiBakiye
    } as unknown as Prisma.InputJsonValue,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return out
}
