import { ParaBirimi, Prisma } from '@prisma/client'
import { formatMoneyDisplay, moneyToApiString, resolveParaBirimi, roundMoney, roundRate, MONEY_NBSP } from './paraBirimi.js'
import { getTcmbPairRate } from './tcmbKur.service.js'

export const YAKLASIK_TRY_UNAVAILABLE_MESSAGE = 'TL karşılığı şu anda hesaplanamadı'

function formatTryMoneyTr(d: Prisma.Decimal): string {
  return formatMoneyDisplay(d, ParaBirimi.TRY)
}

function formatFxRateTr(rate: Prisma.Decimal): string {
  // Gösterim: 48,4305 ₺ (gereksiz sondaki sıfırları kırp, max 8)
  const s = rate.toFixed(8).replace(/\.?0+$/, '')
  const [intPart, frac = ''] = s.split('.')
  const intTr = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const fracTr = frac
  const digits = fracTr ? `${intTr},${fracTr}` : intTr
  return `${digits}${MONEY_NBSP}₺`
}

function formatKurTarihiTr(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  return `${m[3]}.${m[2]}.${m[1]}`
}

function parseAmountLoose(raw: unknown): Prisma.Decimal | null {
  if (raw == null || raw === '') return null
  try {
    let s = String(raw).trim()
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || (s.includes(',') && s.includes('.'))) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else if (s.includes(',')) {
      s = s.replace(',', '.')
    }
    const d = new Prisma.Decimal(s)
    if (!d.isFinite()) return null
    return d
  } catch {
    return null
  }
}

export type YaklasikTryItemIn = { key: string; tutar: string | number }
export type YaklasikTryItemOut = {
  key: string
  tutar: string
  yaklasikTry: string | null
  yaklasikTryGosterim: string | null
  satirEtiket: string | null
}

export type YaklasikTryBatchResult = {
  available: boolean
  message: string | null
  paraBirimi: ParaBirimi
  kurAlis: string | null
  kurTarihi: string | null
  /** örn. 1 USD = 48,4305 ₺ · Kur tarihi: 11.09.2026 */
  kurBilgiSatiri: string | null
  /** Bugünkü TCMB Döviz Alış kuruna göre yaklaşık */
  yaklasikAciklama: string
  items: YaklasikTryItemOut[]
}

/**
 * Tek TCMB çağrısı ile birden fazla tutarın yaklaşık TRY karşılığı (Decimal).
 * Gösterim amaçlıdır — borca/taksite yazılmaz.
 */
export async function computeYaklasikTryBatch(input: {
  paraBirimi: unknown
  items: YaklasikTryItemIn[]
  date?: string
}): Promise<YaklasikTryBatchResult> {
  const paraBirimi = resolveParaBirimi(input.paraBirimi)
  const yaklasikAciklama = 'Bugünkü TCMB Döviz Alış kuruna göre yaklaşık'

  const emptyItems = (input.items ?? []).map((it) => {
    const amt = parseAmountLoose(it.tutar)
    return {
      key: it.key,
      tutar: amt ? moneyToApiString(amt) : '0.00',
      yaklasikTry: null,
      yaklasikTryGosterim: null,
      satirEtiket: null
    }
  })

  if (paraBirimi === ParaBirimi.TRY) {
    return {
      available: false,
      message: null,
      paraBirimi,
      kurAlis: null,
      kurTarihi: null,
      kurBilgiSatiri: null,
      yaklasikAciklama,
      items: emptyItems
    }
  }

  const pair = await getTcmbPairRate(paraBirimi, ParaBirimi.TRY, { date: input.date })
  if (!pair) {
    return {
      available: false,
      message: YAKLASIK_TRY_UNAVAILABLE_MESSAGE,
      paraBirimi,
      kurAlis: null,
      kurTarihi: null,
      kurBilgiSatiri: null,
      yaklasikAciklama,
      items: emptyItems.map((it) => ({
        ...it,
        satirEtiket: YAKLASIK_TRY_UNAVAILABLE_MESSAGE
      }))
    }
  }

  const kur = roundRate(pair.dovizAlis)
  const kurTarihiGosterim = formatKurTarihiTr(pair.bulunanTcmbKurTarihi)
  const kurBilgiSatiri = `1 ${paraBirimi} = ${formatFxRateTr(kur)} · Kur tarihi: ${kurTarihiGosterim}`

  const items: YaklasikTryItemOut[] = (input.items ?? []).map((it) => {
    const amt = parseAmountLoose(it.tutar)
    if (amt == null || amt.lte(0)) {
      return {
        key: it.key,
        tutar: '0.00',
        yaklasikTry: null,
        yaklasikTryGosterim: null,
        satirEtiket: null
      }
    }
    const tryAmt = roundMoney(amt.mul(kur))
    const gosterim = formatTryMoneyTr(tryAmt)
    return {
      key: it.key,
      tutar: moneyToApiString(amt),
      yaklasikTry: moneyToApiString(tryAmt),
      yaklasikTryGosterim: gosterim,
      satirEtiket: `${yaklasikAciklama} ${gosterim}`
    }
  })

  return {
    available: true,
    message: null,
    paraBirimi,
    kurAlis: kur.toFixed(8),
    kurTarihi: pair.bulunanTcmbKurTarihi,
    kurBilgiSatiri,
    yaklasikAciklama,
    items
  }
}

export type CaprazHesapLastEdited = 'mahsup' | 'kasa' | 'kur'

export type CaprazHesapResult = {
  alacakParaBirimi: ParaBirimi
  odemeParaBirimi: ParaBirimi
  mahsupTutari: string
  kasaTutari: string
  uygulanacakKur: string
  onizlemeMetni: string
}

function formatMoneyPb(d: Prisma.Decimal, pb: ParaBirimi): string {
  return formatMoneyDisplay(d, pb)
}

/**
 * Çapraz tahsilat alanları — Decimal; lastEdited hangisinin kaynak olduğunu belirtir.
 * kur = kasa / mahsup → 1 alacak = kur ödeme.
 */
export function resolveCaprazHesapFields(input: {
  alacakParaBirimi: unknown
  odemeParaBirimi: unknown
  mahsupTutari?: unknown
  kasaTutari?: unknown
  uygulanacakKur?: unknown
  lastEdited: CaprazHesapLastEdited
}): CaprazHesapResult | { error: string } {
  const alacakParaBirimi = resolveParaBirimi(input.alacakParaBirimi)
  const odemeParaBirimi = resolveParaBirimi(input.odemeParaBirimi)

  if (alacakParaBirimi === odemeParaBirimi) {
    const mahsup = parseAmountLoose(input.mahsupTutari)
    if (mahsup == null || mahsup.lte(0)) {
      return { error: 'Borçtan düşülecek tutar pozitif olmalıdır.' }
    }
    const m = roundMoney(mahsup)
    return {
      alacakParaBirimi,
      odemeParaBirimi,
      mahsupTutari: moneyToApiString(m),
      kasaTutari: moneyToApiString(m),
      uygulanacakKur: '1.00000000',
      onizlemeMetni: `Kasaya ${formatMoneyPb(m, odemeParaBirimi)} girecek, ${alacakParaBirimi} borçtan ${formatMoneyPb(m, alacakParaBirimi)} düşülecek.`
    }
  }

  let mahsup = parseAmountLoose(input.mahsupTutari)
  let kasa = parseAmountLoose(input.kasaTutari)
  let kur = parseAmountLoose(input.uygulanacakKur)

  if (input.lastEdited === 'mahsup') {
    if (mahsup == null || mahsup.lte(0)) {
      return { error: 'Borçtan düşülecek tutar pozitif olmalıdır.' }
    }
    if (kur == null || kur.lte(0)) {
      return { error: 'Uygulanacak kur pozitif olmalıdır.' }
    }
    mahsup = roundMoney(mahsup)
    kur = roundRate(kur)
    kasa = roundMoney(mahsup.mul(kur))
  } else if (input.lastEdited === 'kasa') {
    if (kasa == null || kasa.lte(0)) {
      return { error: 'Kasaya giren tutar pozitif olmalıdır.' }
    }
    if (kur == null || kur.lte(0)) {
      if (mahsup == null || mahsup.lte(0)) {
        return { error: 'Kur veya mahsup tutarı gerekli.' }
      }
      mahsup = roundMoney(mahsup)
      kasa = roundMoney(kasa)
      kur = roundRate(kasa.div(mahsup))
    } else {
      kur = roundRate(kur)
      kasa = roundMoney(kasa)
      mahsup = roundMoney(kasa.div(kur))
    }
  } else {
    // lastEdited === 'kur'
    if (kur == null || kur.lte(0)) {
      return { error: 'Uygulanacak kur pozitif olmalıdır.' }
    }
    kur = roundRate(kur)
    if (mahsup != null && mahsup.gt(0)) {
      mahsup = roundMoney(mahsup)
      kasa = roundMoney(mahsup.mul(kur))
    } else if (kasa != null && kasa.gt(0)) {
      kasa = roundMoney(kasa)
      mahsup = roundMoney(kasa.div(kur))
    } else {
      return { error: 'Kur ile birlikte mahsup veya kasa tutarı girin.' }
    }
  }

  if (mahsup == null || kasa == null || kur == null) {
    return { error: 'Hesaplama tamamlanamadı.' }
  }

  const kurGosterim =
    odemeParaBirimi === ParaBirimi.TRY
      ? `1 ${alacakParaBirimi} = ${formatFxRateTr(kur)}`
      : `1 ${alacakParaBirimi} = ${kur.toFixed(8)} ${odemeParaBirimi}`

  return {
    alacakParaBirimi,
    odemeParaBirimi,
    mahsupTutari: moneyToApiString(mahsup),
    kasaTutari: moneyToApiString(kasa),
    uygulanacakKur: kur.toFixed(8),
    onizlemeMetni: `Kasaya ${formatMoneyPb(kasa, odemeParaBirimi)} girecek, ${alacakParaBirimi} borçtan ${formatMoneyPb(mahsup, alacakParaBirimi)} düşülecek; uygulanan kur ${kurGosterim}`
  }
}
