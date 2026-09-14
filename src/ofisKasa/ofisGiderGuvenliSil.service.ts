import bcrypt from 'bcrypt'
import type { Prisma, User } from '@prisma/client'
import { OfisKasaIslemTipi, UserRole } from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  OFIS_KASA_KAYNAK_ICRA_TAHSILAT,
  OFIS_KASA_KAYNAK_VEKALET_TAHSILATI,
  serializeOfisKasaHareketi
} from './ofisKasa.service.js'
import {
  assertMasrafSilVerificationAllowed,
  clearMasrafSilPasswordFailures,
  masrafSilAttemptKey,
  recordMasrafSilPasswordFailure
} from '../kasa/masrafSilRateLimit.js'
import { buildMasrafSilindiAuditMessage } from '../kasa/masrafGuvenliSil.service.js'
import { syncTaksitOdemeDurumu } from '../vekalet/vekalet.service.js'
import { onTaksitOdemeChanged } from '../tahsilatBildirim/sync.service.js'

export type GuvenliOfisHareketSilBody = {
  sifre: string
  deleteReason: string
}

export type GuvenliOfisHareketSilMode = 'GIDER_SIL' | 'GELIR_SIL' | 'TAHSILAT_IPTAL'

export type GuvenliOfisHareketSilResult = {
  softDeletedIds: string[]
  auditMessage: string
  mode: GuvenliOfisHareketSilMode
  alreadyDone: boolean
}

const ORPHAN_MSG =
  'Bu gelir bağlı bir tahsilattan oluştuğu için kaynak ödeme doğrulanmadan silinemez.'

async function verifyBuroSahibiPassword(
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

async function softDeleteOfisHareketAndDuzeltmeler(
  tx: Prisma.TransactionClient,
  opts: {
    tenantId: string
    hareketId: string
    actorId: string
    reason: string
    now: Date
    expectedTip: OfisKasaIslemTipi
    /** Bağlı tahsilat iptalinde unique (kaynakTipi,kaynakId) slotunu bırakır; orijinal id audit’te kalır. */
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

/**
 * Büro sahibi + şifre ile Ofis Kasası GIDER / manuel GELIR soft-delete
 * veya bağlı tahsilat iptali (ofis soft-delete; ödeme satırı korunur, bakiyeden düşer).
 */
export async function guvenliOfisHareketSil(
  tenantId: string,
  actor: Pick<User, 'id' | 'role' | 'adSoyad' | 'sifreHash'>,
  hareketId: string,
  body: GuvenliOfisHareketSilBody,
  req: Request
): Promise<GuvenliOfisHareketSilResult> {
  const { reason, meta } = await verifyBuroSahibiPassword(
    tenantId,
    actor,
    hareketId,
    body,
    req,
    'OFIS_HAREKET_SIL'
  )

  const row = await prisma.ofisKasaHareketi.findFirst({
    where: { id: hareketId, tenantId }
  })
  if (!row) {
    throw new AppError(404, 'Kasa hareketi bulunamadı.', 'NOT_FOUND')
  }

  if (row.deletedAt) {
    const mode: GuvenliOfisHareketSilMode =
      row.islemTipi === OfisKasaIslemTipi.GIDER
        ? 'GIDER_SIL'
        : row.kaynakTipi
          ? 'TAHSILAT_IPTAL'
          : 'GELIR_SIL'
    return {
      softDeletedIds: [],
      auditMessage: 'İşlem zaten uygulanmış; bakiye değiştirilmedi.',
      mode,
      alreadyDone: true
    }
  }

  const now = new Date()
  const actorName = actor.adSoyad.trim() || 'Büro sahibi'

  if (row.islemTipi === OfisKasaIslemTipi.GIDER) {
    const auditMessage = buildMasrafSilindiAuditMessage({ actorName, at: now, reason })
    const softDeletedIds = await prisma.$transaction(async (tx) =>
      softDeleteOfisHareketAndDuzeltmeler(tx, {
        tenantId,
        hareketId,
        actorId: actor.id,
        reason,
        now,
        expectedTip: OfisKasaIslemTipi.GIDER
      })
    )
    if (softDeletedIds.length === 0) {
      return {
        softDeletedIds: [],
        auditMessage: 'İşlem zaten uygulanmış; bakiye değiştirilmedi.',
        mode: 'GIDER_SIL',
        alreadyDone: true
      }
    }
    await writeAuditLog({
      tenantId,
      userId: actor.id,
      action: 'OFIS_KASA_GIDER_SOFT_DELETED',
      entityType: 'OfisKasaHareketi',
      entityId: hareketId,
      oldValue: serializeOfisKasaHareketi({ ...row, orijinalHareket: null }),
      newValue: {
        deletedAt: now.toISOString(),
        deletedById: actor.id,
        deleteReason: reason,
        softDeletedIds,
        message: auditMessage
      },
      meta: { belgeNo: row.belgeNo, tutar: row.tutar.toFixed(2), message: auditMessage },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    return { softDeletedIds, auditMessage, mode: 'GIDER_SIL', alreadyDone: false }
  }

  if (row.islemTipi !== OfisKasaIslemTipi.GELIR) {
    throw new AppError(400, 'Bu uç ile yalnızca gider veya gelir silinebilir / iptal edilebilir.', 'INVALID_TYPE')
  }

  const kaynakTipi = row.kaynakTipi?.trim() || null
  const kaynakId = row.kaynakId?.trim() || null

  // Manuel / bağımsız gelir
  if (!kaynakTipi && !kaynakId) {
    const auditMessage = `${actorName}, ${now.toLocaleString('tr-TR')} tarihinde ofis gelirini sildi. Neden: ${reason}`
    const softDeletedIds = await prisma.$transaction(async (tx) =>
      softDeleteOfisHareketAndDuzeltmeler(tx, {
        tenantId,
        hareketId,
        actorId: actor.id,
        reason,
        now,
        expectedTip: OfisKasaIslemTipi.GELIR
      })
    )
    if (softDeletedIds.length === 0) {
      return {
        softDeletedIds: [],
        auditMessage: 'İşlem zaten uygulanmış; bakiye değiştirilmedi.',
        mode: 'GELIR_SIL',
        alreadyDone: true
      }
    }
    await writeAuditLog({
      tenantId,
      userId: actor.id,
      action: 'OFIS_KASA_GELIR_SOFT_DELETED',
      entityType: 'OfisKasaHareketi',
      entityId: hareketId,
      oldValue: serializeOfisKasaHareketi({ ...row, orijinalHareket: null }),
      newValue: {
        deletedAt: now.toISOString(),
        softDeletedIds,
        message: auditMessage
      },
      meta: {
        belgeNo: row.belgeNo,
        tutar: row.tutar.toFixed(2),
        paraBirimi: row.paraBirimi,
        message: auditMessage
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    return { softDeletedIds, auditMessage, mode: 'GELIR_SIL', alreadyDone: false }
  }

  // Bağlı tahsilat — kaynak doğrulanmalı
  if (!kaynakTipi || !kaynakId) {
    throw new AppError(409, ORPHAN_MSG, 'SOURCE_UNVERIFIED')
  }

  if (
    kaynakTipi !== OFIS_KASA_KAYNAK_VEKALET_TAHSILATI &&
    kaynakTipi !== 'VEKALET_TAKSIT_ODEME' &&
    kaynakTipi !== OFIS_KASA_KAYNAK_ICRA_TAHSILAT &&
    kaynakTipi !== 'ICRA_TAHSILAT_ODEME'
  ) {
    throw new AppError(409, ORPHAN_MSG, 'SOURCE_UNVERIFIED')
  }

  if (kaynakTipi === OFIS_KASA_KAYNAK_VEKALET_TAHSILATI || kaynakTipi === 'VEKALET_TAKSIT_ODEME') {
    let odeme = await prisma.vekaletTaksitOdeme.findFirst({
      where: { id: kaynakId, tenantId },
      select: { id: true, taksitId: true, ofisKasaHareketId: true, tutar: true, kasaTutari: true }
    })
    // Eski import: kaynakId yanlış olabilir; ofis bağlantısından doğrula.
    if (!odeme || (odeme.ofisKasaHareketId && odeme.ofisKasaHareketId !== hareketId)) {
      odeme = await prisma.vekaletTaksitOdeme.findFirst({
        where: { tenantId, ofisKasaHareketId: hareketId },
        select: { id: true, taksitId: true, ofisKasaHareketId: true, tutar: true, kasaTutari: true }
      })
    }
    if (!odeme) {
      throw new AppError(409, ORPHAN_MSG, 'SOURCE_UNVERIFIED')
    }

    const auditMessage = `${actorName}, ${now.toLocaleString('tr-TR')} tarihinde vekalet tahsilatını iptal etti. Neden: ${reason}`
    const softDeletedIds = await prisma.$transaction(async (tx) => {
      const ids = await softDeleteOfisHareketAndDuzeltmeler(tx, {
        tenantId,
        hareketId,
        actorId: actor.id,
        reason,
        now,
        expectedTip: OfisKasaIslemTipi.GELIR,
        releaseKaynakSlot: true,
        originalKaynakId: kaynakId
      })
      if (ids.length === 0) return []
      // Ödeme satırı / makbuz korunur; bakiyeden düşmesi için ofis.deletedAt yeterlidir.
      await syncTaksitOdemeDurumu(tx, odeme.taksitId, actor.id)
      return ids
    })

    if (softDeletedIds.length === 0) {
      return {
        softDeletedIds: [],
        auditMessage: 'İşlem zaten uygulanmış; bakiye değiştirilmedi.',
        mode: 'TAHSILAT_IPTAL',
        alreadyDone: true
      }
    }

    await writeAuditLog({
      tenantId,
      userId: actor.id,
      action: 'OFIS_KASA_VEKALET_TAHSILAT_IPTAL',
      entityType: 'OfisKasaHareketi',
      entityId: hareketId,
      oldValue: serializeOfisKasaHareketi({ ...row, orijinalHareket: null }),
      newValue: {
        deletedAt: now.toISOString(),
        softDeletedIds,
        kaynakTipi,
        kaynakId,
        odemeId: odeme.id,
        taksitId: odeme.taksitId,
        message: auditMessage
      },
      meta: {
        belgeNo: row.belgeNo,
        tutar: row.tutar.toFixed(2),
        paraBirimi: row.paraBirimi,
        mahsupTutar: odeme.tutar.toFixed(2),
        kasaTutari: odeme.kasaTutari.toFixed(2),
        message: auditMessage
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })

    void onTaksitOdemeChanged(tenantId, odeme.taksitId).catch(() => {})

    return { softDeletedIds, auditMessage, mode: 'TAHSILAT_IPTAL', alreadyDone: false }
  }

  // ICRA
  const icraOdeme =
    (await prisma.icraTahsilatOdeme.findFirst({
      where: { id: kaynakId, tenantId },
      select: {
        id: true,
        alacakId: true,
        taksitId: true,
        ofisKasaHareketId: true,
        tutar: true,
        kasaTutari: true,
        alacakParaBirimi: true,
        odemeParaBirimi: true
      }
    })) ??
    (await prisma.icraTahsilatOdeme.findFirst({
      where: { tenantId, ofisKasaHareketId: hareketId },
      select: {
        id: true,
        alacakId: true,
        taksitId: true,
        ofisKasaHareketId: true,
        tutar: true,
        kasaTutari: true,
        alacakParaBirimi: true,
        odemeParaBirimi: true
      }
    }))
  if (!icraOdeme) {
    throw new AppError(409, ORPHAN_MSG, 'SOURCE_UNVERIFIED')
  }

  const auditMessage = `${actorName}, ${now.toLocaleString('tr-TR')} tarihinde icra tahsilatını iptal etti. Neden: ${reason}`
  const softDeletedIds = await prisma.$transaction(async (tx) => {
    const ids = await softDeleteOfisHareketAndDuzeltmeler(tx, {
      tenantId,
      hareketId,
      actorId: actor.id,
      reason,
      now,
      expectedTip: OfisKasaIslemTipi.GELIR,
      releaseKaynakSlot: true,
      originalKaynakId: kaynakId
    })
    return ids
  })

  if (softDeletedIds.length === 0) {
    return {
      softDeletedIds: [],
      auditMessage: 'İşlem zaten uygulanmış; bakiye değiştirilmedi.',
      mode: 'TAHSILAT_IPTAL',
      alreadyDone: true
    }
  }

  await writeAuditLog({
    tenantId,
    userId: actor.id,
    action: 'OFIS_KASA_ICRA_TAHSILAT_IPTAL',
    entityType: 'OfisKasaHareketi',
    entityId: hareketId,
    oldValue: serializeOfisKasaHareketi({ ...row, orijinalHareket: null }),
    newValue: {
      deletedAt: now.toISOString(),
      softDeletedIds,
      kaynakTipi,
      kaynakId,
      odemeId: icraOdeme.id,
      alacakId: icraOdeme.alacakId,
      message: auditMessage
    },
    meta: {
      belgeNo: row.belgeNo,
      tutar: row.tutar.toFixed(2),
      paraBirimi: row.paraBirimi,
      mahsupTutar: icraOdeme.tutar.toFixed(2),
      kasaTutari: icraOdeme.kasaTutari.toFixed(2),
      alacakParaBirimi: icraOdeme.alacakParaBirimi,
      odemeParaBirimi: icraOdeme.odemeParaBirimi,
      message: auditMessage
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return { softDeletedIds, auditMessage, mode: 'TAHSILAT_IPTAL', alreadyDone: false }
}

/** @deprecated alias — GIDER yolu `guvenliOfisHareketSil` üzerinden */
export async function guvenliOfisGiderSil(
  tenantId: string,
  actor: Pick<User, 'id' | 'role' | 'adSoyad' | 'sifreHash'>,
  giderId: string,
  body: GuvenliOfisHareketSilBody,
  req: Request
): Promise<{ softDeletedIds: string[]; auditMessage: string }> {
  const r = await guvenliOfisHareketSil(tenantId, actor, giderId, body, req)
  return { softDeletedIds: r.softDeletedIds, auditMessage: r.auditMessage }
}
