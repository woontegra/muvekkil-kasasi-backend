import bcrypt from 'bcrypt'
import type { KasaHareketi, Prisma, User } from '@prisma/client'
import { KasaHareketTipi, UserRole } from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { serializeKasaHareketi } from './kasa.service.js'
import {
  assertMasrafSilVerificationAllowed,
  clearMasrafSilPasswordFailures,
  masrafSilAttemptKey,
  recordMasrafSilPasswordFailure
} from './masrafSilRateLimit.js'

export type GuvenliMasrafSilBody = {
  sifre: string
  deleteReason: string
}

/** Dosya kasasında güvenli soft-delete edilebilen kullanıcı hareketleri. */
export const GUVENLI_SILINEBILIR_KASA_TIPLERI = [
  KasaHareketTipi.MASRAF,
  KasaHareketTipi.AVANS_GIRISI
] as const

export type GuvenliSilinebilirKasaTipi = (typeof GUVENLI_SILINEBILIR_KASA_TIPLERI)[number]

function formatTrDateTime(d: Date): string {
  return d.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function buildMasrafSilindiAuditMessage(opts: {
  actorName: string
  at: Date
  reason: string
}): string {
  return `Masraf, ${opts.actorName} tarafından ${formatTrDateTime(opts.at)} tarihinde silindi. Neden: ${opts.reason}`
}

export function buildAvansSilindiAuditMessage(opts: {
  actorName: string
  at: Date
  reason: string
}): string {
  return `Avans, ${opts.actorName} tarafından ${formatTrDateTime(opts.at)} tarihinde silindi. Neden: ${opts.reason}`
}

/** Aktif (soft-silinmemiş) kasa satırları — listeler ve mali toplamlar. */
export const kasaAktifWhere: Prisma.KasaHareketiWhereInput = { deletedAt: null }

function isGuvenliSilinebilirTip(tip: KasaHareketTipi): tip is GuvenliSilinebilirKasaTipi {
  return (
    tip === KasaHareketTipi.MASRAF || tip === KasaHareketTipi.AVANS_GIRISI
  )
}

/**
 * Büro sahibi + mevcut hesap şifresi ile AVANS_GIRISI / MASRAF soft-delete.
 * Şifre doğrulaması yalnızca bu istek için geçerlidir (kalıcı yetki yok).
 * İlişkili DUZELTME satırları da aynı transaction’da soft-silinir; satırlar korunur.
 * Bakiye etkisi: listeler `deletedAt: null` ile toplandığı için otomatik güncellenir
 * (avans silinince toplam avans/bakiye azalır; masraf silinince toplam masraf azalır, bakiye artar).
 */
export async function guvenliKasaHareketSil(
  tenantId: string,
  actor: Pick<User, 'id' | 'role' | 'adSoyad' | 'sifreHash'>,
  hareketId: string,
  body: GuvenliMasrafSilBody,
  req: Request
): Promise<{ softDeletedIds: string[]; auditMessage: string; tip: GuvenliSilinebilirKasaTipi }> {
  if (actor.role !== UserRole.BURO_SAHIBI) {
    throw new AppError(
      403,
      'Kasa kaydı silme yalnızca büro sahibi tarafından yapılabilir.',
      'FORBIDDEN'
    )
  }

  const reason = body.deleteReason?.trim() ?? ''
  if (reason.length < 3) {
    throw new AppError(422, 'Silme nedeni zorunludur (en az 3 karakter).', 'VALIDATION_ERROR')
  }
  if (reason.length > 1000) {
    throw new AppError(422, 'Silme nedeni en fazla 1000 karakter olabilir.', 'VALIDATION_ERROR')
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
      action: 'KASA_SIL_RATE_LIMITED',
      entityType: 'KasaHareketi',
      entityId: hareketId,
      meta: { reason: 'PASSWORD_VERIFY_BLOCKED' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(
      429,
      'Çok fazla başarısız silme denemesi. 15 dakika sonra tekrar deneyin.',
      'KASA_SIL_RATE_LIMITED'
    )
  }

  const passwordOk = await bcrypt.compare(sifre, actor.sifreHash)
  if (!passwordOk) {
    const blocked = recordMasrafSilPasswordFailure(rateKey)
    await writeAuditLog({
      tenantId,
      userId: actor.id,
      action: 'KASA_SIL_PASSWORD_FAILED',
      entityType: 'KasaHareketi',
      entityId: hareketId,
      meta: { blocked },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(401, 'Şifre yanlış, kayıt silinmedi', 'INVALID_PASSWORD')
  }

  clearMasrafSilPasswordFailures(rateKey)

  const row = await prisma.kasaHareketi.findFirst({
    where: { id: hareketId, tenantId, ...kasaAktifWhere }
  })
  if (!row) {
    throw new AppError(404, 'Kasa kaydı bulunamadı.', 'NOT_FOUND')
  }
  if (!isGuvenliSilinebilirTip(row.tip)) {
    throw new AppError(
      400,
      'Yalnızca avans ve masraf kayıtları bu uç ile silinebilir.',
      'INVALID_TYPE'
    )
  }

  const tip = row.tip
  const now = new Date()
  const actorName = actor.adSoyad.trim() || 'Büro sahibi'
  const auditMessage =
    tip === KasaHareketTipi.AVANS_GIRISI
      ? buildAvansSilindiAuditMessage({ actorName, at: now, reason })
      : buildMasrafSilindiAuditMessage({ actorName, at: now, reason })

  const softDeletedIds = await prisma.$transaction(async (tx) => {
    // Eşzamanlı iki istekte yalnızca biri kazanır (deletedAt IS NULL).
    const primary = await tx.kasaHareketi.updateMany({
      where: {
        id: hareketId,
        tenantId,
        tip,
        deletedAt: null
      },
      data: {
        deletedAt: now,
        deletedById: actor.id,
        deleteReason: reason,
        updatedById: actor.id
      }
    })
    if (primary.count !== 1) {
      throw new AppError(409, 'Kayıt zaten silinmiş veya eşzamanlı işlem çakıştı.', 'CONFLICT')
    }

    const related = await tx.kasaHareketi.findMany({
      where: {
        tenantId,
        tip: KasaHareketTipi.DUZELTME,
        orijinalHareketId: hareketId,
        deletedAt: null
      },
      select: { id: true }
    })
    const relatedIds = related.map((r) => r.id)
    if (relatedIds.length > 0) {
      await tx.kasaHareketi.updateMany({
        where: { id: { in: relatedIds }, tenantId, deletedAt: null },
        data: {
          deletedAt: now,
          deletedById: actor.id,
          deleteReason: reason,
          updatedById: actor.id
        }
      })
    }

    return [hareketId, ...relatedIds]
  })

  const auditAction =
    tip === KasaHareketTipi.AVANS_GIRISI ? 'KASA_AVANS_SOFT_DELETED' : 'KASA_MASRAF_SOFT_DELETED'

  await writeAuditLog({
    tenantId,
    userId: actor.id,
    action: auditAction,
    entityType: 'KasaHareketi',
    entityId: hareketId,
    oldValue: serializeKasaHareketi({ ...row, orijinalHareket: null }),
    newValue: {
      deletedAt: now.toISOString(),
      deletedById: actor.id,
      deleteReason: reason,
      softDeletedIds,
      tip,
      message: auditMessage
    },
    meta: {
      dosyaId: row.dosyaId,
      belgeNo: row.belgeNo,
      tutar: row.tutar.toFixed(2),
      tip,
      onayDurumu: row.onayDurumu,
      message: auditMessage
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return { softDeletedIds, auditMessage, tip }
}

/** @deprecated — `guvenliKasaHareketSil` kullanın (MASRAF + AVANS). */
export async function guvenliMasrafSil(
  tenantId: string,
  actor: Pick<User, 'id' | 'role' | 'adSoyad' | 'sifreHash'>,
  masrafId: string,
  body: GuvenliMasrafSilBody,
  req: Request
): Promise<{ softDeletedIds: string[]; auditMessage: string }> {
  const r = await guvenliKasaHareketSil(tenantId, actor, masrafId, body, req)
  return { softDeletedIds: r.softDeletedIds, auditMessage: r.auditMessage }
}

export type { KasaHareketi }
