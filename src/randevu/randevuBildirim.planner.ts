import {
  BildirimIsDurumu,
  BildirimKanali,
  BildirimPlanKaynagi,
  BildirimPlanModu,
  Prisma
} from '@prisma/client'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { evaluateAutoBildirimEligibility } from '../tahsilatBildirim/eligibility.service.js'
import { isWhatsAppBaglantiConnected } from '../tahsilatBildirim/connection.public.js'
import { adjustRandevuPlanForQuietHours } from '../tahsilatBildirim/quietHours.js'
import {
  BILDIRIM_ONERI_BASLANGIC_DK,
  BILDIRIM_ONERI_BITIS_DK
} from '../tahsilatBildirim/sendWindow.js'
import { getSessizSaatleriDikkateAl } from '../tahsilatBildirim/sessizSaatColumn.js'
import {
  ensureRandevuBildirimDefaults,
  loadEffectiveRandevuReminders
} from './randevuBildirim.settings.js'

function idempotencyKey(
  tenantId: string,
  randevuId: string,
  offsetDk: number,
  planKaynagi: string,
  planVersion: number
): string {
  return `${tenantId}|${randevuId}|${offsetDk}|WHATSAPP|${planKaynagi}|v${planVersion}`
}

export async function cancelPendingRandevuJobs(
  tenantId: string,
  randevuId: string,
  iptalNedeni: string
): Promise<number> {
  const result = await prisma.randevuBildirimIsi.updateMany({
    where: {
      tenantId,
      randevuId,
      durum: { in: [BildirimIsDurumu.PLANLANDI, BildirimIsDurumu.KUYRUKTA] }
    },
    data: {
      durum: BildirimIsDurumu.IPTAL_EDILDI,
      iptalNedeni,
      lockedAt: null,
      lockedBy: null
    }
  })
  return result.count
}

async function resolveProvider(tenantId: string): Promise<'WHATSAPP_CLOUD_API' | 'MANUAL_WHATSAPP'> {
  const baglanti = await prisma.whatsAppBaglanti.findUnique({
    where: { tenantId },
    select: { durum: true }
  })
  const useCloud =
    env.WHATSAPP_CLOUD_API_ENABLED && isWhatsAppBaglantiConnected(baglanti?.durum)
  return useCloud ? 'WHATSAPP_CLOUD_API' : 'MANUAL_WHATSAPP'
}

export async function planRandevuJobsForRandevu(
  tenantId: string,
  randevuId: string
): Promise<{ created: number; cancelled: number }> {
  if (!env.WHATSAPP_AUTOMATION_ENABLED) return { created: 0, cancelled: 0 }

  await ensureRandevuBildirimDefaults(tenantId)
  const ayar = await prisma.randevuBildirimAyar.findUnique({ where: { tenantId } })
  if (!ayar?.otomasyonAktif) return { created: 0, cancelled: 0 }

  const randevu = await prisma.randevu.findFirst({
    where: { id: randevuId, tenantId, aktifMi: true },
    include: {
      muvekkil: { select: { id: true, otomatikBildirimIzni: true, aktifMi: true } }
    }
  })
  if (!randevu?.muvekkilId || !randevu.muvekkil?.aktifMi) {
    const cancelled = await cancelPendingRandevuJobs(tenantId, randevuId, 'Müvekkil yok veya pasif')
    return { created: 0, cancelled }
  }

  const elig = evaluateAutoBildirimEligibility({
    tenantOtomasyonAktif: Boolean(ayar?.otomasyonAktif),
    muvekkilIzni: randevu.muvekkil.otomatikBildirimIzni,
    dosyaAktif: true,
    taksitAktif: true
  })
  if (!elig.eligible) {
    const cancelled = await cancelPendingRandevuJobs(tenantId, randevuId, elig.kullaniciMesaji)
    return { created: 0, cancelled }
  }

  const { mode, reminders } = await loadEffectiveRandevuReminders(tenantId, randevuId)
  if (mode === BildirimPlanModu.KAPALI || reminders.length === 0) {
    const cancelled = await cancelPendingRandevuJobs(tenantId, randevuId, 'Hatırlatma kapalı')
    return { created: 0, cancelled }
  }

  const cancelled = await cancelPendingRandevuJobs(tenantId, randevuId, 'Plan güncellendi')
  const provider = await resolveProvider(tenantId)
  const now = new Date()
  let created = 0

  const tahsilatAyar = await prisma.tahsilatBildirimAyar.findUnique({
    where: { tenantId },
    select: {
      izinliSaatBaslangic: true,
      izinliSaatBitis: true
    }
  })
  const sessizAktif = await getSessizSaatleriDikkateAl(tenantId)
  const aktifBas = tahsilatAyar?.izinliSaatBaslangic ?? BILDIRIM_ONERI_BASLANGIC_DK
  const aktifBit = tahsilatAyar?.izinliSaatBitis ?? BILDIRIM_ONERI_BITIS_DK

  for (const r of reminders) {
    const idealAt = new Date(randevu.baslangicAt.getTime() - r.offsetDk * 60_000)
    const planlananAt = sessizAktif
      ? adjustRandevuPlanForQuietHours(idealAt, randevu.baslangicAt, aktifBas, aktifBit)
      : idealAt
    if (!planlananAt || planlananAt <= now) continue
    if (planlananAt >= randevu.baslangicAt) continue

    const key = idempotencyKey(
      tenantId,
      randevuId,
      r.offsetDk,
      r.planKaynagi,
      r.planVersion
    )

    try {
      await prisma.randevuBildirimIsi.create({
        data: {
          tenantId,
          randevuId,
          muvekkilId: randevu.muvekkilId,
          kanal: BildirimKanali.WHATSAPP,
          provider,
          offsetDk: r.offsetDk,
          planlananAt,
          durum: BildirimIsDurumu.PLANLANDI,
          planKaynagi: r.planKaynagi as BildirimPlanKaynagi,
          planVersion: r.planVersion,
          metaSablonId: r.metaSablonId,
          idempotencyKey: key
        }
      })
      created += 1
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Aynı anahtar: yalnızca bekleyen işin saatini güncelle (çift mesaj yok).
        const updated = await prisma.randevuBildirimIsi.updateMany({
          where: {
            idempotencyKey: key,
            durum: { in: [BildirimIsDurumu.PLANLANDI, BildirimIsDurumu.KUYRUKTA] }
          },
          data: {
            planlananAt,
            lockedAt: null,
            lockedBy: null,
            metaSablonId: r.metaSablonId
          }
        })
        if (updated.count > 0) created += 1
        continue
      }
      throw e
    }
  }

  return { created, cancelled }
}

export async function replanRandevuJobs(
  tenantId: string,
  randevuId: string
): Promise<{ created: number; cancelled: number }> {
  return planRandevuJobsForRandevu(tenantId, randevuId)
}

export async function planRandevuJobsForTenant(tenantId: string): Promise<{ created: number }> {
  const randevular = await prisma.randevu.findMany({
    where: {
      tenantId,
      aktifMi: true,
      baslangicAt: { gt: new Date() },
      muvekkilId: { not: null }
    },
    select: { id: true }
  })
  let created = 0
  for (const r of randevular) {
    const res = await planRandevuJobsForRandevu(tenantId, r.id)
    created += res.created
  }
  return { created }
}
