/**
 * Salt okunur plan önizlemesi — DB yazmaz, Meta çağırmaz.
 * planJobsForTenant ile aynı uygunluk kurallarını kullanır.
 */
import {
  BildirimKanali,
  BildirimKuralTuru,
  BildirimPlanModu,
  VekaletTaksitOdemeDurumu
} from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { env } from '../config/env.js'
import { evaluateAutoBildirimEligibility } from './eligibility.service.js'
import { mapTaksitOtomatikBildirimAktif } from './taksitBildirimColumn.js'
import { addDaysYmd, planAtFromYmdAndMinutes, ymdTr } from './time.js'
import { isWhatsAppBaglantiConnected } from './connection.public.js'
import { loadEffectiveTaksitRules, resolveTaksitPlanMode } from './bildirimPlan.service.js'
import { maskPhone, normalizeTurkiyePhone } from './phone.js'

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

export type PreviewWouldPlanJob = {
  taksitId: string
  taksitNo: number
  vadeYmd: string
  kuralTuru: BildirimKuralTuru
  gonderimSaatiDk: number
  planlananAtIso: string
  kalan: number
  telefonMaskeli: string | null
  muvekkilAd: string | null
  dosyaNo: string | null
  alreadyExists: boolean
}

export type PreviewBlockedTaksit = {
  taksitId: string
  taksitNo: number
  vadeYmd: string
  engel: string
  telefonMaskeli: string | null
}

export type PreviewTenantResult = {
  tenantId: string
  buroAdi: string
  skipped: boolean
  reason: string | null
  otomasyonAktif: boolean | null
  baglantiDurum: string | null
  cloudReady: boolean
  adayTaksitSayisi: number
  uygunTaksitSayisi: number
  bugunPlanlanacakIs: number
  wouldPlan: PreviewWouldPlanJob[]
  blockers: PreviewBlockedTaksit[]
  blockerSummary: Record<string, number>
}

export type PreviewAllResult = {
  dryRun: true
  writesDb: false
  callsMeta: false
  automationEnabled: boolean
  cloudApiEnabled: boolean
  todayYmd: string
  minutesNowTr: number
  tenants: number
  totals: {
    adayTaksit: number
    uygunTaksit: number
    bugunPlanlanacakIs: number
  }
  results: PreviewTenantResult[]
}

export async function previewPlanJobsForTenant(tenantId: string): Promise<PreviewTenantResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, buroAdi: true }
  })
  const buroAdi = tenant?.buroAdi ?? tenantId

  const base = (partial: Partial<PreviewTenantResult>): PreviewTenantResult => ({
    tenantId,
    buroAdi,
    skipped: true,
    reason: null,
    otomasyonAktif: null,
    baglantiDurum: null,
    cloudReady: false,
    adayTaksitSayisi: 0,
    uygunTaksitSayisi: 0,
    bugunPlanlanacakIs: 0,
    wouldPlan: [],
    blockers: [],
    blockerSummary: {},
    ...partial
  })

  if (!env.WHATSAPP_AUTOMATION_ENABLED) {
    return base({ reason: 'whatsapp_automation_disabled' })
  }

  const ayar = await prisma.tahsilatBildirimAyar.findUnique({ where: { tenantId } })
  const baglanti = await prisma.whatsAppBaglanti.findUnique({
    where: { tenantId },
    select: { durum: true }
  })
  const cloudReady =
    env.WHATSAPP_CLOUD_API_ENABLED && isWhatsAppBaglantiConnected(baglanti?.durum)

  if (!ayar?.otomasyonAktif) {
    return base({
      reason: 'otomasyon_kapali',
      otomasyonAktif: false,
      baglantiDurum: baglanti?.durum ?? null,
      cloudReady
    })
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
      dosya: { select: { id: true, dosyaNo: true, otomatikBildirimAktif: true } },
      muvekkil: {
        select: {
          id: true,
          gorunenAd: true,
          telefon: true,
          otomatikBildirimIzni: true
        }
      }
    }
  })

  const taksitAktifMap = await mapTaksitOtomatikBildirimAktif(taksitler.map((t) => t.id))
  const wouldPlan: PreviewWouldPlanJob[] = []
  const blockers: PreviewBlockedTaksit[] = []
  const blockerSummary: Record<string, number> = {}
  let uygunTaksitSayisi = 0

  const bump = (engel: string) => {
    blockerSummary[engel] = (blockerSummary[engel] ?? 0) + 1
  }

  for (const taksit of taksitler) {
    const telefonMaskeli = taksit.muvekkil.telefon
      ? maskPhone(normalizeTurkiyePhone(taksit.muvekkil.telefon) ?? taksit.muvekkil.telefon)
      : null
    const vadeYmd = ymdTr(taksit.vadeTarihi)
    const baseBlock = {
      taksitId: taksit.id,
      taksitNo: taksit.taksitNo,
      vadeYmd,
      telefonMaskeli
    }

    const planMode = await resolveTaksitPlanMode(tenantId, taksit.id)
    if (planMode.mode === BildirimPlanModu.KAPALI) {
      const engel = 'taksit_plan_kapali'
      bump(engel)
      blockers.push({ ...baseBlock, engel })
      continue
    }

    const elig = evaluateAutoBildirimEligibility({
      tenantOtomasyonAktif: true,
      muvekkilIzni: taksit.muvekkil.otomatikBildirimIzni,
      dosyaAktif: taksit.dosya.otomatikBildirimAktif,
      taksitAktif: taksitAktifMap.get(taksit.id) ?? true
    })
    if (!elig.eligible) {
      const engel = elig.kullaniciMesaji
      bump(engel)
      blockers.push({ ...baseBlock, engel })
      continue
    }

    const kalan = Math.max(0, Number(taksit.tutar) - sumOdeme(taksit.odemeler))
    if (kalan <= 0.001) {
      const engel = 'borc_kapandi'
      bump(engel)
      blockers.push({ ...baseBlock, engel })
      continue
    }

    const effectiveRules = await loadEffectiveTaksitRules(tenantId, taksit.id)
    if (!effectiveRules?.length) {
      const engel = 'etkin_kural_yok'
      bump(engel)
      blockers.push({ ...baseBlock, engel })
      continue
    }

    const aktifKurallar = effectiveRules.filter((r) => r.aktifMi)
    if (aktifKurallar.length === 0) {
      const engel = 'aktif_kural_yok'
      bump(engel)
      blockers.push({ ...baseBlock, engel })
      continue
    }

    uygunTaksitSayisi += 1
    let plannedForTaksit = 0

    for (const rule of aktifKurallar) {
      const planYmd = targetYmdForRule(vadeYmd, rule.kuralTuru, rule.gunOffset)
      if (planYmd !== todayYmd) {
        bump(`kural_bugun_degil:${rule.kuralTuru}`)
        continue
      }

      const key = `${tenantId}|${taksit.id}|${rule.kuralTuru}|${BildirimKanali.WHATSAPP}|${planYmd}|${rule.planKaynagi}|v${rule.planVersion}`
      const existing = await prisma.tahsilatBildirimIsi.findUnique({
        where: { idempotencyKey: key },
        select: { id: true, durum: true }
      })
      const planlananAt = planAtFromYmdAndMinutes(planYmd, rule.gonderimSaatiDk)
      wouldPlan.push({
        taksitId: taksit.id,
        taksitNo: taksit.taksitNo,
        vadeYmd,
        kuralTuru: rule.kuralTuru,
        gonderimSaatiDk: rule.gonderimSaatiDk,
        planlananAtIso: planlananAt.toISOString(),
        kalan: Number(kalan.toFixed(2)),
        telefonMaskeli,
        muvekkilAd: taksit.muvekkil.gorunenAd,
        dosyaNo: taksit.dosya.dosyaNo,
        alreadyExists: Boolean(existing)
      })
      plannedForTaksit += 1
    }

    if (plannedForTaksit === 0) {
      bump('uygun_ama_bugun_kural_yok')
      blockers.push({ ...baseBlock, engel: 'uygun_ama_bugun_kural_yok' })
    }
  }

  return base({
    skipped: false,
    reason: null,
    otomasyonAktif: true,
    baglantiDurum: baglanti?.durum ?? null,
    cloudReady,
    adayTaksitSayisi: taksitler.length,
    uygunTaksitSayisi,
    bugunPlanlanacakIs: wouldPlan.length,
    wouldPlan,
    blockers,
    blockerSummary
  })
}

export async function previewPlanJobsForAllTenants(): Promise<PreviewAllResult> {
  const { minutesNowTr } = await import('./time.js')
  const tenants = await prisma.tenant.findMany({
    where: { aktifMi: true },
    select: { id: true, buroAdi: true },
    orderBy: { buroAdi: 'asc' }
  })

  const results: PreviewTenantResult[] = []
  for (const t of tenants) {
    results.push(await previewPlanJobsForTenant(t.id))
  }

  return {
    dryRun: true,
    writesDb: false,
    callsMeta: false,
    automationEnabled: env.WHATSAPP_AUTOMATION_ENABLED === true,
    cloudApiEnabled: env.WHATSAPP_CLOUD_API_ENABLED === true,
    todayYmd: ymdTr(new Date()),
    minutesNowTr: minutesNowTr(new Date()),
    tenants: tenants.length,
    totals: {
      adayTaksit: results.reduce((s, r) => s + r.adayTaksitSayisi, 0),
      uygunTaksit: results.reduce((s, r) => s + r.uygunTaksitSayisi, 0),
      bugunPlanlanacakIs: results.reduce((s, r) => s + r.bugunPlanlanacakIs, 0)
    },
    results
  }
}
