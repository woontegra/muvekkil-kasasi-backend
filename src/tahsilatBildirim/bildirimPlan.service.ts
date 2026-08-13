/**
 * Entity bazlı bildirim plan override (taksit / randevu).
 */
import type { Request } from 'express'
import {
  BildirimEntityType,
  BildirimKanali,
  BildirimKuralTuru,
  BildirimPlanKaynagi,
  BildirimPlanModu
} from '@prisma/client'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { cancelPendingBildirimJobs } from './eligibility.service.js'
import { planJobsForTenant } from './planner.service.js'
import {
  getTaksitOtomatikBildirimAktif,
  mapTaksitOtomatikBildirimAktif,
  setTaksitOtomatikBildirimAktif
} from './taksitBildirimColumn.js'
import { replanRandevuJobs } from '../randevu/randevuBildirim.planner.js'

export const RANDEVU_OFFSET_PRESETS: Array<{ ruleKey: string; offsetDk: number; label: string }> = [
  { ruleKey: 'OFFSET_30', offsetDk: 30, label: '30 dakika önce' },
  { ruleKey: 'OFFSET_60', offsetDk: 60, label: '1 saat önce' },
  { ruleKey: 'OFFSET_120', offsetDk: 120, label: '2 saat önce' },
  { ruleKey: 'OFFSET_1440', offsetDk: 1440, label: '1 gün önce' }
]

export type TaksitPlanKuralInput = {
  kuralTuru: BildirimKuralTuru
  aktifMi: boolean
  gunOffset: number
  gonderimSaatiDk: number
  metaSablonId: string | null
}

export type RandevuPlanKuralInput = {
  ruleKey: string
  aktifMi: boolean
  offsetDk: number
  metaSablonId: string | null
}

export async function resolveTaksitPlanMode(
  tenantId: string,
  taksitId: string
): Promise<{ mode: BildirimPlanModu; planVersion: number; entityId: string | null }> {
  const otomatikAktif = await getTaksitOtomatikBildirimAktif(taksitId)
  const row = await prisma.bildirimPlanEntity.findUnique({
    where: {
      tenantId_entityType_entityId_kanal: {
        tenantId,
        entityType: BildirimEntityType.VEKALET_TAKSITI,
        entityId: taksitId,
        kanal: BildirimKanali.WHATSAPP
      }
    }
  })
  if (!row) {
    return {
      mode: otomatikAktif ? BildirimPlanModu.VARSAYILAN : BildirimPlanModu.KAPALI,
      planVersion: 1,
      entityId: null
    }
  }
  if (row.mode === BildirimPlanModu.KAPALI || !otomatikAktif) {
    return { mode: BildirimPlanModu.KAPALI, planVersion: row.planVersion, entityId: row.id }
  }
  return { mode: row.mode, planVersion: row.planVersion, entityId: row.id }
}

async function loadTaksitPlanKurallari(planEntityId: string) {
  return prisma.bildirimPlanKural.findMany({
    where: { planEntityId },
    orderBy: { ruleKey: 'asc' }
  })
}

export async function getTaksitHatirlatmaPlan(tenantId: string, taksitId: string) {
  const taksit = await prisma.vekaletTaksiti.findFirst({
    where: { id: taksitId, tenantId },
    select: { id: true }
  })
  if (!taksit) throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')

  const resolved = await resolveTaksitPlanMode(tenantId, taksitId)
  const kurallar =
    resolved.entityId && resolved.mode === BildirimPlanModu.OZEL
      ? await loadTaksitPlanKurallari(resolved.entityId)
      : []

  return {
    mode: resolved.mode,
    planVersion: resolved.planVersion,
    kurallar: kurallar.map((k) => ({
      kuralTuru: k.ruleKey as BildirimKuralTuru,
      aktifMi: k.aktifMi,
      gunOffset: k.gunOffset,
      gonderimSaatiDk: k.gonderimSaatiDk,
      metaSablonId: k.metaSablonId
    })),
    ozet: buildTaksitPlanOzet(resolved.mode, kurallar)
  }
}

function buildTaksitPlanOzet(
  mode: BildirimPlanModu,
  kurallar: Array<{ ruleKey: string; aktifMi: boolean; gunOffset: number }>
): string {
  if (mode === BildirimPlanModu.KAPALI) return 'Kapalı'
  if (mode === BildirimPlanModu.VARSAYILAN) return 'Büro ayarı'
  const parts: string[] = []
  for (const k of kurallar) {
    if (!k.aktifMi) continue
    if (k.ruleKey === BildirimKuralTuru.VADEDEN_ONCE) parts.push(`${k.gunOffset} gün önce`)
    else if (k.ruleKey === BildirimKuralTuru.VADE_GUNU) parts.push('Vade günü')
    else if (k.ruleKey === BildirimKuralTuru.VADE_SONRASI) parts.push(`${k.gunOffset} gün sonra`)
  }
  return parts.length ? `Özel · ${parts.join(' · ')}` : 'Özel'
}

export async function setTaksitHatirlatmaPlan(input: {
  tenantId: string
  userId: string
  taksitId: string
  mode: BildirimPlanModu
  kurallar?: TaksitPlanKuralInput[]
  req: Request
}): Promise<{ mode: BildirimPlanModu; iptalEdilen: number; planlanan: number }> {
  const taksit = await prisma.vekaletTaksiti.findFirst({
    where: { id: input.taksitId, tenantId: input.tenantId },
    select: { id: true }
  })
  if (!taksit) throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')

  if (input.mode === BildirimPlanModu.OZEL) {
    if (!input.kurallar?.length) {
      throw new AppError(422, 'Özel planda en az bir kural gerekir.', 'VALIDATION')
    }
    for (const k of input.kurallar) {
      if (k.kuralTuru === BildirimKuralTuru.VADE_GUNU && k.gunOffset !== 0) {
        throw new AppError(422, 'Vade günü kuralında gün offset 0 olmalıdır.', 'VALIDATION')
      }
      if (k.kuralTuru !== BildirimKuralTuru.VADE_GUNU && k.aktifMi && k.gunOffset < 1) {
        throw new AppError(422, 'Gün offset en az 1 olmalıdır.', 'VALIDATION')
      }
    }
  }

  const meta = getRequestMeta(input.req)
  const prev = await resolveTaksitPlanMode(input.tenantId, input.taksitId)

  if (input.mode === BildirimPlanModu.KAPALI) {
    await setTaksitOtomatikBildirimAktif(input.taksitId, false)
    await prisma.bildirimPlanEntity.deleteMany({
      where: {
        tenantId: input.tenantId,
        entityType: BildirimEntityType.VEKALET_TAKSITI,
        entityId: input.taksitId
      }
    })
  } else {
    await setTaksitOtomatikBildirimAktif(input.taksitId, true)
    const entity = await prisma.bildirimPlanEntity.upsert({
      where: {
        tenantId_entityType_entityId_kanal: {
          tenantId: input.tenantId,
          entityType: BildirimEntityType.VEKALET_TAKSITI,
          entityId: input.taksitId,
          kanal: BildirimKanali.WHATSAPP
        }
      },
      create: {
        tenantId: input.tenantId,
        entityType: BildirimEntityType.VEKALET_TAKSITI,
        entityId: input.taksitId,
        mode: input.mode,
        planVersion: 1
      },
      update: {
        mode: input.mode,
        planVersion: { increment: 1 }
      }
    })

    if (input.mode === BildirimPlanModu.OZEL && input.kurallar) {
      await prisma.bildirimPlanKural.deleteMany({ where: { planEntityId: entity.id } })
      for (const k of input.kurallar) {
        await prisma.bildirimPlanKural.create({
          data: {
            tenantId: input.tenantId,
            planEntityId: entity.id,
            ruleKey: k.kuralTuru,
            aktifMi: k.aktifMi,
            gunOffset: k.kuralTuru === BildirimKuralTuru.VADE_GUNU ? 0 : k.gunOffset,
            gonderimSaatiDk: k.gonderimSaatiDk,
            metaSablonId: k.metaSablonId
          }
        })
      }
    } else if (input.mode === BildirimPlanModu.VARSAYILAN) {
      await prisma.bildirimPlanKural.deleteMany({ where: { planEntityId: entity.id } })
    }
  }

  const iptalEdilen = await cancelPendingBildirimJobs(
    { tenantId: input.tenantId, taksitId: input.taksitId },
    'Taksit hatırlatma planı güncellendi'
  )
  const planned =
    input.mode === BildirimPlanModu.KAPALI ? { created: 0 } : await planJobsForTenant(input.tenantId)

  await writeAuditLog({
    tenantId: input.tenantId,
    userId: input.userId,
    action: 'TAKSIT_HATIRLATMA_PLAN_UPDATED',
    entityType: 'VekaletTaksiti',
    entityId: input.taksitId,
    oldValue: { mode: prev.mode },
    newValue: { mode: input.mode },
    meta: { iptalEdilen, planlanan: planned.created },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return { mode: input.mode, iptalEdilen, planlanan: planned.created }
}

export async function getRandevuHatirlatmaPlan(tenantId: string, randevuId: string) {
  const randevu = await prisma.randevu.findFirst({
    where: { id: randevuId, tenantId, aktifMi: true },
    select: { id: true }
  })
  if (!randevu) throw new AppError(404, 'Randevu bulunamadı.', 'NOT_FOUND')

  const row = await prisma.bildirimPlanEntity.findUnique({
    where: {
      tenantId_entityType_entityId_kanal: {
        tenantId,
        entityType: BildirimEntityType.RANDEVU,
        entityId: randevuId,
        kanal: BildirimKanali.WHATSAPP
      }
    },
    include: { kurallar: true }
  })

  const mode = row?.mode ?? BildirimPlanModu.VARSAYILAN
  const pending = await prisma.randevuBildirimIsi.findMany({
    where: {
      tenantId,
      randevuId,
      durum: { in: ['PLANLANDI', 'KUYRUKTA'] }
    },
    select: { offsetDk: true, planlananAt: true },
    orderBy: { planlananAt: 'asc' }
  })

  return {
    mode,
    planVersion: row?.planVersion ?? 1,
    kurallar: (row?.kurallar ?? []).map((k) => ({
      ruleKey: k.ruleKey,
      aktifMi: k.aktifMi,
      offsetDk: k.offsetDk ?? 0,
      metaSablonId: k.metaSablonId
    })),
    ozet: buildRandevuPlanOzet(mode, row?.kurallar ?? [], pending),
    planlananHatirlatmalar: pending.map((p) => ({
      offsetDk: p.offsetDk,
      planlananAt: p.planlananAt.toISOString()
    }))
  }
}

function buildRandevuPlanOzet(
  mode: BildirimPlanModu,
  kurallar: Array<{ ruleKey: string; aktifMi: boolean; offsetDk: number | null }>,
  pending: Array<{ offsetDk: number }>
): string {
  if (mode === BildirimPlanModu.KAPALI) return 'Hatırlatma kapalı'
  if (mode === BildirimPlanModu.VARSAYILAN) return 'Büro ayarı'
  const labels = kurallar
    .filter((k) => k.aktifMi)
    .map((k) => offsetLabel(k.offsetDk ?? presetOffset(k.ruleKey)))
  if (labels.length) return labels.join(' + ')
  if (pending.length) return pending.map((p) => offsetLabel(p.offsetDk)).join(' + ')
  return 'Özel'
}

function presetOffset(ruleKey: string): number {
  return RANDEVU_OFFSET_PRESETS.find((p) => p.ruleKey === ruleKey)?.offsetDk ?? 0
}

export function offsetLabel(offsetDk: number): string {
  if (offsetDk === 30) return '30 dk önce'
  if (offsetDk === 60) return '1 saat önce'
  if (offsetDk === 120) return '2 saat önce'
  if (offsetDk === 1440) return '1 gün önce'
  if (offsetDk >= 1440 && offsetDk % 1440 === 0) return `${offsetDk / 1440} gün önce`
  if (offsetDk >= 60 && offsetDk % 60 === 0) return `${offsetDk / 60} saat önce`
  return `${offsetDk} dk önce`
}

export async function setRandevuHatirlatmaPlan(input: {
  tenantId: string
  userId: string
  randevuId: string
  mode: BildirimPlanModu
  kurallar?: RandevuPlanKuralInput[]
  req: Request
}): Promise<{ mode: BildirimPlanModu; iptalEdilen: number; planlanan: number }> {
  const randevu = await prisma.randevu.findFirst({
    where: { id: input.randevuId, tenantId: input.tenantId, aktifMi: true },
    select: { id: true }
  })
  if (!randevu) throw new AppError(404, 'Randevu bulunamadı.', 'NOT_FOUND')

  if (input.mode === BildirimPlanModu.OZEL && !input.kurallar?.some((k) => k.aktifMi)) {
    throw new AppError(422, 'Özel planda en az bir hatırlatma seçin.', 'VALIDATION')
  }

  const meta = getRequestMeta(input.req)

  if (input.mode === BildirimPlanModu.KAPALI) {
    await prisma.bildirimPlanEntity.deleteMany({
      where: {
        tenantId: input.tenantId,
        entityType: BildirimEntityType.RANDEVU,
        entityId: input.randevuId
      }
    })
  } else {
    const entity = await prisma.bildirimPlanEntity.upsert({
      where: {
        tenantId_entityType_entityId_kanal: {
          tenantId: input.tenantId,
          entityType: BildirimEntityType.RANDEVU,
          entityId: input.randevuId,
          kanal: BildirimKanali.WHATSAPP
        }
      },
      create: {
        tenantId: input.tenantId,
        entityType: BildirimEntityType.RANDEVU,
        entityId: input.randevuId,
        mode: input.mode,
        planVersion: 1
      },
      update: {
        mode: input.mode,
        planVersion: { increment: 1 }
      }
    })

    if (input.mode === BildirimPlanModu.OZEL && input.kurallar) {
      await prisma.bildirimPlanKural.deleteMany({ where: { planEntityId: entity.id } })
      for (const k of input.kurallar) {
        await prisma.bildirimPlanKural.create({
          data: {
            tenantId: input.tenantId,
            planEntityId: entity.id,
            ruleKey: k.ruleKey,
            aktifMi: k.aktifMi,
            offsetDk: k.offsetDk,
            metaSablonId: k.metaSablonId
          }
        })
      }
    } else if (input.mode === BildirimPlanModu.VARSAYILAN) {
      await prisma.bildirimPlanKural.deleteMany({ where: { planEntityId: entity.id } })
    }
  }

  const replan = await replanRandevuJobs(input.tenantId, input.randevuId)

  await writeAuditLog({
    tenantId: input.tenantId,
    userId: input.userId,
    action: 'RANDEVU_HATIRLATMA_PLAN_UPDATED',
    entityType: 'Randevu',
    entityId: input.randevuId,
    newValue: { mode: input.mode },
    meta: replan,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return { mode: input.mode, iptalEdilen: replan.cancelled, planlanan: replan.created }
}

export type EffectiveTaksitRule = {
  kuralTuru: BildirimKuralTuru
  aktifMi: boolean
  gunOffset: number
  gonderimSaatiDk: number
  metaSablonId: string | null
  planKaynagi: BildirimPlanKaynagi
  planVersion: number
}

export async function loadEffectiveTaksitRules(
  tenantId: string,
  taksitId: string
): Promise<EffectiveTaksitRule[] | null> {
  const { mode, planVersion, entityId } = await resolveTaksitPlanMode(tenantId, taksitId)
  if (mode === BildirimPlanModu.KAPALI) return null

  if (mode === BildirimPlanModu.OZEL && entityId) {
    const custom = await loadTaksitPlanKurallari(entityId)
    return custom.map((k) => ({
      kuralTuru: k.ruleKey as BildirimKuralTuru,
      aktifMi: k.aktifMi,
      gunOffset: k.gunOffset,
      gonderimSaatiDk: k.gonderimSaatiDk,
      metaSablonId: k.metaSablonId,
      planKaynagi: BildirimPlanKaynagi.OZEL,
      planVersion
    }))
  }

  const tenantRules = await prisma.tahsilatBildirimKurali.findMany({
    where: { tenantId, kanal: BildirimKanali.WHATSAPP }
  })
  return tenantRules.map((r) => ({
    kuralTuru: r.kuralTuru,
    aktifMi: r.aktifMi,
    gunOffset: r.gunOffset,
    gonderimSaatiDk: r.gonderimSaatiDk,
    metaSablonId: r.metaSablonId,
    planKaynagi: BildirimPlanKaynagi.VARSAYILAN,
    planVersion: 1
  }))
}

export async function loadTaksitPlanModesBatch(
  tenantId: string,
  taksitIds: string[]
): Promise<Map<string, BildirimPlanModu>> {
  const map = new Map<string, BildirimPlanModu>()
  if (taksitIds.length === 0) return map

  const rows = await prisma.bildirimPlanEntity.findMany({
    where: {
      tenantId,
      entityType: BildirimEntityType.VEKALET_TAKSITI,
      entityId: { in: taksitIds }
    }
  })
  const aktifMap = await mapTaksitOtomatikBildirimAktif(taksitIds)

  for (const id of taksitIds) {
    const row = rows.find((r) => r.entityId === id)
    const aktif = aktifMap.get(id) ?? true
    if (!aktif || row?.mode === BildirimPlanModu.KAPALI) {
      map.set(id, BildirimPlanModu.KAPALI)
    } else if (row?.mode === BildirimPlanModu.OZEL) {
      map.set(id, BildirimPlanModu.OZEL)
    } else {
      map.set(id, BildirimPlanModu.VARSAYILAN)
    }
  }
  return map
}
