import {
  BildirimIsDurumu,
  BildirimKanali,
  BildirimKuralTuru,
  Prisma,
  VekaletTaksitOdemeDurumu
} from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { ensureTenantBildirimDefaults } from './settings.service.js'
import { evaluateAutoBildirimEligibility } from './eligibility.service.js'
import { mapTaksitOtomatikBildirimAktif } from './taksitBildirimColumn.js'
import { addDaysYmd, planAtFromYmdAndMinutes, ymdTr } from './time.js'

function sumOdeme(tutarlar: { tutar: { toString: () => string } }[]): number {
  return tutarlar.reduce((s, o) => s + Number(o.tutar), 0)
}

function targetYmdForRule(
  vadeYmd: string,
  kuralTuru: BildirimKuralTuru,
  gunOffset: number
): string {
  switch (kuralTuru) {
    case BildirimKuralTuru.VADEDEN_ONCE:
      return addDaysYmd(vadeYmd, -gunOffset)
    case BildirimKuralTuru.VADE_GUNU:
      return vadeYmd
    case BildirimKuralTuru.VADE_SONRASI:
      return addDaysYmd(vadeYmd, gunOffset)
    default:
      return vadeYmd
  }
}

function idempotencyKey(
  tenantId: string,
  taksitId: string,
  kuralTuru: BildirimKuralTuru,
  kanal: BildirimKanali,
  planYmd: string
): string {
  return `${tenantId}|${taksitId}|${kuralTuru}|${kanal}|${planYmd}`
}

export type PlanJobsResult = {
  tenantId: string
  skipped: boolean
  reason?: string
  created: number
  cancelled: number
}

async function cancelObsoleteJobsForTenant(tenantId: string): Promise<number> {
  const pending = await prisma.tahsilatBildirimIsi.findMany({
    where: {
      tenantId,
      durum: { in: [BildirimIsDurumu.PLANLANDI, BildirimIsDurumu.KUYRUKTA] }
    },
    select: {
      id: true,
      taksitId: true,
      taksit: {
        select: {
          odemeDurumu: true,
          tutar: true,
          odemeler: { select: { tutar: true } }
        }
      }
    }
  })

  let cancelled = 0
  for (const job of pending) {
    const iptal = job.taksit.odemeDurumu === VekaletTaksitOdemeDurumu.IPTAL
    const kalan = Math.max(0, Number(job.taksit.tutar) - sumOdeme(job.taksit.odemeler))
    const kapandi = kalan <= 0.001
    if (!iptal && !kapandi) continue

    await prisma.tahsilatBildirimIsi.update({
      where: { id: job.id },
      data: {
        durum: BildirimIsDurumu.IPTAL_EDILDI,
        iptalNedeni: iptal ? 'Taksit iptal edildi' : 'Borç kapandı',
        lockedAt: null,
        lockedBy: null
      }
    })
    cancelled += 1
  }
  return cancelled
}

export async function planJobsForTenant(tenantId: string): Promise<PlanJobsResult> {
  await ensureTenantBildirimDefaults(tenantId)

  const ayar = await prisma.tahsilatBildirimAyar.findUnique({ where: { tenantId } })
  const cancelled = await cancelObsoleteJobsForTenant(tenantId)

  if (!ayar?.otomasyonAktif) {
    return { tenantId, skipped: true, reason: 'otomasyon_kapali', created: 0, cancelled }
  }

  const rules = await prisma.tahsilatBildirimKurali.findMany({
    where: { tenantId, aktifMi: true, kanal: BildirimKanali.WHATSAPP }
  })
  if (rules.length === 0) {
    return { tenantId, skipped: false, created: 0, cancelled }
  }

  const todayYmd = ymdTr(new Date())

  const taksitler = await prisma.vekaletTaksiti.findMany({
    where: {
      tenantId,
      odemeDurumu: { not: VekaletTaksitOdemeDurumu.IPTAL },
      dosya: { aktifMi: true },
      muvekkil: { aktifMi: true }
    },
    include: {
      odemeler: { select: { tutar: true } },
      dosya: { select: { id: true, otomatikBildirimAktif: true } },
      muvekkil: { select: { id: true, otomatikBildirimIzni: true } }
    }
  })

  let created = 0
  const taksitAktifMap = await mapTaksitOtomatikBildirimAktif(taksitler.map((t) => t.id))

  for (const taksit of taksitler) {
    const elig = evaluateAutoBildirimEligibility({
      tenantOtomasyonAktif: true,
      muvekkilIzni: taksit.muvekkil.otomatikBildirimIzni,
      dosyaAktif: taksit.dosya.otomatikBildirimAktif,
      taksitAktif: taksitAktifMap.get(taksit.id) ?? true
    })
    if (!elig.eligible) continue

    const kalan = Math.max(0, Number(taksit.tutar) - sumOdeme(taksit.odemeler))
    if (kalan <= 0.001) continue

    const vadeYmd = ymdTr(taksit.vadeTarihi)

    for (const rule of rules) {
      const planYmd = targetYmdForRule(vadeYmd, rule.kuralTuru, rule.gunOffset)
      if (planYmd !== todayYmd) continue

      const key = idempotencyKey(tenantId, taksit.id, rule.kuralTuru, BildirimKanali.WHATSAPP, planYmd)
      const planlananAt = planAtFromYmdAndMinutes(planYmd, rule.gonderimSaatiDk)

      try {
        await prisma.tahsilatBildirimIsi.create({
          data: {
            tenantId,
            muvekkilId: taksit.muvekkilId,
            dosyaId: taksit.dosyaId,
            taksitId: taksit.id,
            kanal: BildirimKanali.WHATSAPP,
            provider: 'MANUAL_WHATSAPP',
            kuralTuru: rule.kuralTuru,
            planlananAt,
            kalanTutarSnapshot: new Prisma.Decimal(kalan.toFixed(2)),
            durum: BildirimIsDurumu.PLANLANDI,
            idempotencyKey: key,
            providerAdi: 'MANUAL_WHATSAPP'
          }
        })
        created += 1
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          continue
        }
        throw e
      }
    }
  }

  return { tenantId, skipped: false, created, cancelled }
}

export async function planJobsForAllTenants(): Promise<{
  tenants: number
  created: number
  cancelled: number
  results: PlanJobsResult[]
}> {
  const tenants = await prisma.tenant.findMany({
    where: { aktifMi: true },
    select: { id: true }
  })

  const results: PlanJobsResult[] = []
  let created = 0
  let cancelled = 0

  for (const t of tenants) {
    const r = await planJobsForTenant(t.id)
    results.push(r)
    created += r.created
    cancelled += r.cancelled
  }

  return { tenants: tenants.length, created, cancelled, results }
}
