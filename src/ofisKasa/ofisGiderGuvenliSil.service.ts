import type { User } from '@prisma/client'
import { OfisKasaIslemTipi } from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  OFIS_KASA_KAYNAK_ICRA_TAHSILAT,
  OFIS_KASA_KAYNAK_VEKALET_TAHSILATI,
  serializeOfisKasaHareketi
} from './ofisKasa.service.js'
import { buildMasrafSilindiAuditMessage } from '../kasa/masrafGuvenliSil.service.js'
import {
  findOdemeIdByOfisHareket,
  iptalVekaletTahsilatAuthenticated
} from '../vekalet/vekaletTahsilatIptal.service.js'
import { onTaksitOdemeChanged } from '../tahsilatBildirim/sync.service.js'
import {
  softDeleteOfisHareketAndDuzeltmeler,
  verifyBuroSahibiPassword,
  type GuvenliOfisHareketSilBody
} from './ofisGuvenliSilCore.js'

export type { GuvenliOfisHareketSilBody } from './ofisGuvenliSilCore.js'
export { softDeleteOfisHareketAndDuzeltmeler, verifyBuroSahibiPassword } from './ofisGuvenliSilCore.js'

export type GuvenliOfisHareketSilMode = 'GIDER_SIL' | 'GELIR_SIL' | 'TAHSILAT_IPTAL'

export type GuvenliOfisHareketSilResult = {
  softDeletedIds: string[]
  auditMessage: string
  mode: GuvenliOfisHareketSilMode
  alreadyDone: boolean
}

const ORPHAN_MSG =
  'Bu gelir bağlı bir tahsilattan oluştuğu için kaynak ödeme doğrulanmadan silinemez.'

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
    // Ofis zaten silinmiş olsa bile vekalet kaynağında iptalAt eksik kalmış olabilir — ortak servis tamir eder.
    if (
      row.kaynakTipi === OFIS_KASA_KAYNAK_VEKALET_TAHSILATI ||
      row.kaynakTipi === 'VEKALET_TAKSIT_ODEME'
    ) {
      const odemeId = await findOdemeIdByOfisHareket(tenantId, hareketId, row.kaynakId)
      if (odemeId) {
        const fixed = await iptalVekaletTahsilatAuthenticated(
          tenantId,
          actor,
          odemeId,
          reason,
          meta
        )
        return {
          softDeletedIds: fixed.softDeletedOfisIds,
          auditMessage: fixed.auditMessage,
          mode: 'TAHSILAT_IPTAL',
          alreadyDone: fixed.alreadyDone
        }
      }
    }
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
    const odemeId = await findOdemeIdByOfisHareket(tenantId, hareketId, kaynakId)
    if (!odemeId) {
      throw new AppError(409, ORPHAN_MSG, 'SOURCE_UNVERIFIED')
    }
    const result = await iptalVekaletTahsilatAuthenticated(
      tenantId,
      actor,
      odemeId,
      reason,
      meta
    )
    return {
      softDeletedIds: result.softDeletedOfisIds,
      auditMessage: result.auditMessage,
      mode: 'TAHSILAT_IPTAL',
      alreadyDone: result.alreadyDone
    }
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
