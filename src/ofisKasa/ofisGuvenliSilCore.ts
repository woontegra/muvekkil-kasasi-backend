import bcrypt from 'bcrypt'
import type { Prisma, User } from '@prisma/client'
import { OfisKasaIslemTipi, UserRole } from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  assertMasrafSilVerificationAllowed,
  clearMasrafSilPasswordFailures,
  masrafSilAttemptKey,
  recordMasrafSilPasswordFailure
} from '../kasa/masrafSilRateLimit.js'

export type GuvenliOfisHareketSilBody = {
  sifre: string
  deleteReason: string
}

export async function verifyBuroSahibiPassword(
  tenantId: string,
  actor: Pick<User, 'id' | 'role' | 'adSoyad' | 'sifreHash'>,
  entityId: string,
  body: GuvenliOfisHareketSilBody,
  req: Request,
  auditPrefix: string
): Promise<{ reason: string; meta: ReturnType<typeof getRequestMeta> }> {
  if (actor.role !== UserRole.BURO_SAHIBI) {
    throw new AppError(403, 'Bu işlem yalnızca büro sahibi tarafından yapılabilir.', 'FORBIDDEN')
  }

  const reason = body.deleteReason?.trim() ?? ''
  if (reason.length < 3) {
    throw new AppError(422, 'Silme / iptal nedeni zorunludur (en az 3 karakter).', 'VALIDATION_ERROR')
  }
  if (reason.length > 1000) {
    throw new AppError(422, 'Neden en fazla 1000 karakter olabilir.', 'VALIDATION_ERROR')
  }
  const sifre = body.sifre ?? ''
  if (!sifre) {
    throw new AppError(422, 'Şifre zorunludur.', 'VALIDATION_ERROR')
  }

  const meta = getRequestMeta(req)
  const rateKey = masrafSilAttemptKey(tenantId, actor.id, meta.ipAddress)

  try {
    assertMasrafSilVerificationAllowed(rateKey)
  } catch {
    await writeAuditLog({
      tenantId,
      userId: actor.id,
      action: `${auditPrefix}_RATE_LIMITED`,
      entityType: 'OfisKasaHareketi',
      entityId,
      meta: { reason: 'PASSWORD_VERIFY_BLOCKED' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(
      429,
      'Çok fazla başarısız deneme. 15 dakika sonra tekrar deneyin.',
      'MASRAF_SIL_RATE_LIMITED'
    )
  }

  const passwordOk = await bcrypt.compare(sifre, actor.sifreHash)
  if (!passwordOk) {
    const blocked = recordMasrafSilPasswordFailure(rateKey)
    await writeAuditLog({
      tenantId,
      userId: actor.id,
      action: `${auditPrefix}_PASSWORD_FAILED`,
      entityType: 'OfisKasaHareketi',
      entityId,
      meta: { blocked },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(401, 'Şifre yanlış, işlem yapılmadı', 'INVALID_PASSWORD')
  }

  clearMasrafSilPasswordFailures(rateKey)
  return { reason, meta }
}

export async function softDeleteOfisHareketAndDuzeltmeler(
  tx: Prisma.TransactionClient,
  opts: {
    tenantId: string
    hareketId: string
    actorId: string
    reason: string
    now: Date
    expectedTip: OfisKasaIslemTipi
    releaseKaynakSlot?: boolean
    originalKaynakId?: string | null
  }
): Promise<string[]> {
  const primary = await tx.ofisKasaHareketi.updateMany({
    where: {
      id: opts.hareketId,
      tenantId: opts.tenantId,
      islemTipi: opts.expectedTip,
      deletedAt: null
    },
    data: {
      deletedAt: opts.now,
      deletedById: opts.actorId,
      deleteReason: opts.reason,
      updatedById: opts.actorId,
      ...(opts.releaseKaynakSlot && opts.originalKaynakId
        ? { kaynakId: `${opts.originalKaynakId}#iptal#${opts.now.getTime()}` }
        : {})
    }
  })
  if (primary.count !== 1) {
    return []
  }

  const related = await tx.ofisKasaHareketi.findMany({
    where: {
      tenantId: opts.tenantId,
      islemTipi: OfisKasaIslemTipi.DUZELTME,
      orijinalHareketId: opts.hareketId,
      deletedAt: null
    },
    select: { id: true }
  })
  const relatedIds = related.map((r) => r.id)
  if (relatedIds.length > 0) {
    await tx.ofisKasaHareketi.updateMany({
      where: { id: { in: relatedIds }, tenantId: opts.tenantId, deletedAt: null },
      data: {
        deletedAt: opts.now,
        deletedById: opts.actorId,
        deleteReason: opts.reason,
        updatedById: opts.actorId
      }
    })
  }
  return [opts.hareketId, ...relatedIds]
}
