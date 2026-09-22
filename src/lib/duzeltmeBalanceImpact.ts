/**
 * Düzeltme bakiye etkisi — Prisma.Decimal; işaretli string API/UI için.
 */
import { Prisma } from '@prisma/client'
import { moneyToApiString } from './paraBirimi.js'

export type BalanceImpactSign = 'positive' | 'negative' | 'zero'

export type BalanceImpactDto = {
  /** Decimal string fixed-2, signed (+/−) API tutarı */
  amount: string
  sign: BalanceImpactSign
  /** UI: +₺500,00 / −$500,00 / ₺0,00 */
  display: string
}

const MINUS = '\u2212' // −

function currencySymbol(pb: string): { prefix: string; suffix: string } {
  if (pb === 'USD') return { prefix: '$', suffix: '' }
  if (pb === 'EUR') return { prefix: '€', suffix: '' }
  return { prefix: '', suffix: `\u00A0₺` }
}

function digitsTr(abs: Prisma.Decimal): string {
  const n = abs.toFixed(2)
  const [intPart, frac = '00'] = n.split('.')
  const intTr = Number(intPart).toLocaleString('tr-TR')
  return `${intTr},${frac}`
}

/** Düzeltme tutarı = bakiye etkisi (signed Decimal). */
export function computeBalanceImpact(
  tutar: Prisma.Decimal | string | number,
  paraBirimi: string
): BalanceImpactDto {
  const d = tutar instanceof Prisma.Decimal ? tutar : new Prisma.Decimal(tutar)
  const cmp = d.comparedTo(0)
  const sign: BalanceImpactSign = cmp === 0 ? 'zero' : cmp > 0 ? 'positive' : 'negative'
  const abs = d.abs()
  const { prefix, suffix } = currencySymbol(paraBirimi)
  const body = `${prefix}${digitsTr(abs)}${suffix}`
  let display: string
  if (sign === 'zero') display = body
  else if (sign === 'positive') display = `+${body}`
  else display = `${MINUS}${body}`
  return {
    amount: moneyToApiString(d),
    sign,
    display
  }
}

/**
 * Eski tutar → yeni tutar (mümkünse).
 * GELIR/AVANS: yeni = eski + etki
 * GIDER/MASRAF: yeni = eski − etki (etki bakiyeyi artırıyorsa gider küçülür)
 */
export function computeEskiYeniTutar(opts: {
  orijinalTutar: Prisma.Decimal | string | number
  duzeltmeTutar: Prisma.Decimal | string | number
  orijinalTip: string
}): { eskiTutar: string; yeniTutar: string } | null {
  const eski = opts.orijinalTutar instanceof Prisma.Decimal
    ? opts.orijinalTutar
    : new Prisma.Decimal(opts.orijinalTutar)
  const etki = opts.duzeltmeTutar instanceof Prisma.Decimal
    ? opts.duzeltmeTutar
    : new Prisma.Decimal(opts.duzeltmeTutar)
  const tip = opts.orijinalTip.toUpperCase()
  const isExpense =
    tip === 'GIDER' || tip === 'MASRAF' || tip === 'DOVIZ_CIKIS'
  const yeni = isExpense ? eski.minus(etki) : eski.plus(etki)
  if (yeni.isNegative()) return null
  return {
    eskiTutar: moneyToApiString(eski),
    yeniTutar: moneyToApiString(yeni)
  }
}
