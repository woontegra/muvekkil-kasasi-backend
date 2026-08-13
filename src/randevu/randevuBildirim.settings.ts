import {
  BildirimEntityType,
  BildirimKanali,
  BildirimPlanModu,
  Prisma
} from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { RANDEVU_OFFSET_PRESETS } from '../tahsilatBildirim/bildirimPlan.service.js'

export async function ensureRandevuBildirimDefaults(tenantId: string): Promise<void> {
  await prisma.randevuBildirimAyar.upsert({
    where: { tenantId },
    create: { tenantId, otomasyonAktif: false },
    update: {}
  })
  for (const p of RANDEVU_OFFSET_PRESETS) {
    await prisma.randevuBildirimVarsayilanKural.upsert({
      where: { tenantId_offsetDk: { tenantId, offsetDk: p.offsetDk } },
      create: {
        tenantId,
        offsetDk: p.offsetDk,
        aktifMi: p.offsetDk === 60
      },
      update: {}
    })
  }
}

export async function getRandevuBildirimSettings(tenantId: string) {
  await ensureRandevuBildirimDefaults(tenantId)
  const ayar = await prisma.randevuBildirimAyar.findUniqueOrThrow({ where: { tenantId } })
  const kurallar = await prisma.randevuBildirimVarsayilanKural.findMany({
    where: { tenantId },
    orderBy: { offsetDk: 'asc' }
  })
  return {
    otomasyonAktif: ayar.otomasyonAktif,
    varsayilanKurallar: kurallar.map((k) => ({
      offsetDk: k.offsetDk,
      aktifMi: k.aktifMi,
      metaSablonId: k.metaSablonId,
      label: RANDEVU_OFFSET_PRESETS.find((p) => p.offsetDk === k.offsetDk)?.label ?? `${k.offsetDk} dk`
    }))
  }
}

export async function updateRandevuBildirimSettings(
  tenantId: string,
  input: {
    otomasyonAktif: boolean
    varsayilanKurallar: Array<{ offsetDk: number; aktifMi: boolean; metaSablonId: string | null }>
  }
) {
  await ensureRandevuBildirimDefaults(tenantId)
  await prisma.randevuBildirimAyar.update({
    where: { tenantId },
    data: { otomasyonAktif: input.otomasyonAktif }
  })
  for (const k of input.varsayilanKurallar) {
    await prisma.randevuBildirimVarsayilanKural.upsert({
      where: { tenantId_offsetDk: { tenantId, offsetDk: k.offsetDk } },
      create: {
        tenantId,
        offsetDk: k.offsetDk,
        aktifMi: k.aktifMi,
        metaSablonId: k.metaSablonId
      },
      update: { aktifMi: k.aktifMi, metaSablonId: k.metaSablonId }
    })
  }
  return getRandevuBildirimSettings(tenantId)
}

export type EffectiveRandevuReminder = {
  offsetDk: number
  metaSablonId: string | null
  planKaynagi: 'VARSAYILAN' | 'OZEL'
  planVersion: number
}

export async function loadEffectiveRandevuReminders(
  tenantId: string,
  randevuId: string
): Promise<{ mode: BildirimPlanModu; reminders: EffectiveRandevuReminder[] }> {
  const entity = await prisma.bildirimPlanEntity.findUnique({
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
  const mode = entity?.mode ?? BildirimPlanModu.VARSAYILAN
  const planVersion = entity?.planVersion ?? 1

  if (mode === BildirimPlanModu.KAPALI) {
    return { mode, reminders: [] }
  }

  if (mode === BildirimPlanModu.OZEL) {
    return {
      mode,
      reminders: (entity?.kurallar ?? [])
        .filter((k) => k.aktifMi && k.offsetDk != null)
        .map((k) => ({
          offsetDk: k.offsetDk!,
          metaSablonId: k.metaSablonId,
          planKaynagi: 'OZEL' as const,
          planVersion
        }))
    }
  }

  const varsayilan = await prisma.randevuBildirimVarsayilanKural.findMany({
    where: { tenantId, aktifMi: true }
  })
  return {
    mode,
    reminders: varsayilan.map((k) => ({
      offsetDk: k.offsetDk,
      metaSablonId: k.metaSablonId,
      planKaynagi: 'VARSAYILAN' as const,
      planVersion: 1
    }))
  }
}
