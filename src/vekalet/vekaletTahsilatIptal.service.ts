/**
 * Ortak vekalet tahsilat iptali — Ofis Kasası ve dosya vekalet ekranı aynı çekirdeği kullanır.
 * Soft-delete / iptal; makbuz fiziksel silinmez; kur snapshot korunur; idempotent.
 */
import {
  MakbuzDurumu,
  OfisKasaIslemTipi,
  type Prisma,
  type User
} from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  softDeleteOfisHareketAndDuzeltmeler,
  verifyBuroSahibiPassword,
  type GuvenliOfisHareketSilBody
} from '../ofisKasa/ofisGuvenliSilCore.js'
import { onTaksitOdemeChanged } from '../tahsilatBildirim/sync.service.js'
import { syncTaksitOdemeDurumu } from './vekalet.service.js'

export const VEKALET_TAHSILAT_ESMM_BLOCK =
  'Bu tahsilata bağlı resmî e-SMM (SMM no) kaydı var. Güvenli iptal için önce e-SMM usulüne uygun iptal edilmelidir.'

export type GuvenliVekaletTahsilatIptalResult = {
  alreadyDone: boolean
  odemeId: string
  taksitId: string
  softDeletedOfisIds: string[]
  auditMessage: string
}

type OdemeIptalRow = {
  id: string
  tenantId: string
  taksitId: string
  tutar: Prisma.Decimal
  kasaTutari: Prisma.Decimal
  makbuzNo: string
  iptalAt: Date | null
  ofisKasaHareketId: string | null
  kasaHareketId: string | null
  ofisKasaHareket: { id: string; deletedAt: Date | null } | null
  kasaHareket: { id: string; deletedAt: Date | null } | null
  taksit: { id: string; taksitNo: number; smmNo: string | null }
}

export async function applyVekaletTahsilatIptalInTx(
  tx: Prisma.TransactionClient,
  opts: {
    tenantId: string
    actorId: string
    odeme: OdemeIptalRow
    reason: string
    now: Date
  }
): Promise<{ softDeletedOfisIds: string[]; odemeWasAlreadyIptal: boolean }> {
  const { tenantId, actorId, odeme, reason, now } = opts
  const softDeletedOfisIds: string[] = []

  if (odeme.ofisKasaHareketId) {
    if (!odeme.ofisKasaHareket || odeme.ofisKasaHareket.deletedAt == null) {
      const ids = await softDeleteOfisHareketAndDuzeltmeler(tx, {
        tenantId,
        hareketId: odeme.ofisKasaHareketId,
        actorId,
        reason,
        now,
        expectedTip: OfisKasaIslemTipi.GELIR,
        releaseKaynakSlot: true,
        originalKaynakId: odeme.id
      })
      softDeletedOfisIds.push(...ids)
    }
  }

  if (odeme.kasaHareketId && (!odeme.kasaHareket || odeme.kasaHareket.deletedAt == null)) {
    await tx.kasaHareketi.updateMany({
      where: { id: odeme.kasaHareketId, tenantId, deletedAt: null },
      data: {
        deletedAt: now,
        deletedById: actorId,
        deleteReason: reason
      }
    })
  }

  const odemeWasAlreadyIptal = odeme.iptalAt != null
  if (!odemeWasAlreadyIptal) {
    await tx.vekaletTaksitOdeme.update({
      where: { id: odeme.id },
      data: {
        iptalAt: now,
        iptalById: actorId,
        iptalNedeni: reason.slice(0, 1000),
        makbuzDurumu: MakbuzDurumu.IPTAL
      }
    })
  }

  await syncTaksitOdemeDurumu(tx, odeme.taksitId, actorId)
  return { softDeletedOfisIds, odemeWasAlreadyIptal }
}

export async function loadOdemeForTahsilatIptal(
  tenantId: string,
  odemeId: string
): Promise<OdemeIptalRow | null> {
  return prisma.vekaletTaksitOdeme.findFirst({
    where: { id: odemeId, tenantId },
    include: {
      ofisKasaHareket: { select: { id: true, deletedAt: true } },
      kasaHareket: { select: { id: true, deletedAt: true } },
      taksit: { select: { id: true, taksitNo: true, smmNo: true } }
    }
  })
}

export async function findOdemeIdByOfisHareket(
  tenantId: string,
  ofisHareketId: string,
  kaynakIdHint?: string | null
): Promise<string | null> {
  if (kaynakIdHint) {
    const byHint = await prisma.vekaletTaksitOdeme.findFirst({
      where: { id: kaynakIdHint, tenantId },
      select: { id: true, ofisKasaHareketId: true }
    })
    if (byHint && (!byHint.ofisKasaHareketId || byHint.ofisKasaHareketId === ofisHareketId)) {
      return byHint.id
    }
  }
  const byOfis = await prisma.vekaletTaksitOdeme.findFirst({
    where: { tenantId, ofisKasaHareketId: ofisHareketId },
    select: { id: true }
  })
  return byOfis?.id ?? null
}

/** Şifre doğrulanmış actor ile iptal (Ofis Kasası yolu burayı çağırır). */
export async function iptalVekaletTahsilatAuthenticated(
  tenantId: string,
  actor: Pick<User, 'id' | 'adSoyad'>,
  odemeId: string,
  reason: string,
  meta: ReturnType<typeof getRequestMeta>
): Promise<GuvenliVekaletTahsilatIptalResult> {
  const odeme = await loadOdemeForTahsilatIptal(tenantId, odemeId)
  if (!odeme) {
    throw new AppError(404, 'Ödeme kaydı bulunamadı.', 'NOT_FOUND')
  }
  if ((odeme.taksit.smmNo?.trim() ?? '').length > 0) {
    throw new AppError(409, VEKALET_TAHSILAT_ESMM_BLOCK, 'VEKALET_ESMM_BLOCK')
  }

  const now = new Date()
  const actorName = actor.adSoyad.trim() || 'Büro sahibi'

  const txResult = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT id FROM "vekalet_taksit_odeme"
      WHERE id = ${odeme.id} AND tenant_id = ${tenantId}
      FOR UPDATE
    `
    const fresh = await tx.vekaletTaksitOdeme.findFirst({
      where: { id: odeme.id, tenantId },
      include: {
        ofisKasaHareket: { select: { id: true, deletedAt: true } },
        kasaHareket: { select: { id: true, deletedAt: true } },
        taksit: { select: { id: true, taksitNo: true, smmNo: true } }
      }
    })
    if (!fresh) throw new AppError(404, 'Ödeme kaydı bulunamadı.', 'NOT_FOUND')
    return applyVekaletTahsilatIptalInTx(tx, {
      tenantId,
      actorId: actor.id,
      odeme: fresh,
      reason,
      now
    })
  })

  const alreadyDone =
    txResult.odemeWasAlreadyIptal && txResult.softDeletedOfisIds.length === 0
  const auditMessage = alreadyDone
    ? 'Tahsilat zaten iptal edilmişti; bakiye değiştirilmedi.'
    : `${actorName}, ${now.toLocaleString('tr-TR')} tarihinde taksit #${odeme.taksit.taksitNo} tahsilatını iptal etti. Neden: ${reason}`

  await writeAuditLog({
    tenantId,
    userId: actor.id,
    action: alreadyDone ? 'VEKALET_TAHSILAT_IPTAL_IDEMPOTENT' : 'VEKALET_TAHSILAT_IPTAL',
    entityType: 'VekaletTaksitOdeme',
    entityId: odeme.id,
    oldValue: {
      id: odeme.id,
      taksitId: odeme.taksitId,
      taksitNo: odeme.taksit.taksitNo,
      makbuzNo: odeme.makbuzNo,
      tutar: odeme.tutar.toFixed(2),
      kasaTutari: odeme.kasaTutari.toFixed(2),
      iptalAt: odeme.iptalAt?.toISOString() ?? null,
      ofisKasaHareketId: odeme.ofisKasaHareketId,
      ofisDeletedAt: odeme.ofisKasaHareket?.deletedAt?.toISOString() ?? null
    },
    newValue: {
      iptalAt: now.toISOString(),
      softDeletedOfisIds: txResult.softDeletedOfisIds,
      taksitId: odeme.taksitId,
      taksitNo: odeme.taksit.taksitNo,
      message: auditMessage
    },
    meta: {
      taksitId: odeme.taksitId,
      makbuzNo: odeme.makbuzNo,
      mahsup: odeme.tutar.toFixed(2),
      kasaTutari: odeme.kasaTutari.toFixed(2),
      deleteReason: reason,
      alreadyDone
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  void onTaksitOdemeChanged(tenantId, odeme.taksitId).catch(() => {})

  return {
    alreadyDone,
    odemeId: odeme.id,
    taksitId: odeme.taksitId,
    softDeletedOfisIds: txResult.softDeletedOfisIds,
    auditMessage
  }
}

/** Dosya vekalet ekranı — şifre + neden. */
export async function guvenliIptalVekaletTahsilat(
  tenantId: string,
  actor: Pick<User, 'id' | 'role' | 'adSoyad' | 'sifreHash'>,
  odemeId: string,
  body: GuvenliOfisHareketSilBody,
  req: Request
): Promise<GuvenliVekaletTahsilatIptalResult> {
  const { reason, meta } = await verifyBuroSahibiPassword(
    tenantId,
    actor,
    odemeId,
    body,
    req,
    'VEKALET_TAHSILAT_IPTAL'
  )
  return iptalVekaletTahsilatAuthenticated(tenantId, actor, odemeId, reason, meta)
}
