/**
 * Kârlılık Analizi — para birimi kovaları (Decimal; kur dönüşümü yok).
 */
import { Prisma } from '@prisma/client'
import { moneyToApiString } from '../lib/paraBirimi.js'

export type KarlilikCurrency = 'TRY' | 'USD' | 'EUR'

export type DecimalByCurrency = Record<KarlilikCurrency, Prisma.Decimal>

export type MoneyByCurrency = Record<KarlilikCurrency, string>

export const KARLILIK_CURRENCIES: readonly KarlilikCurrency[] = ['TRY', 'USD', 'EUR'] as const

export function zeroDecimal(): Prisma.Decimal {
  return new Prisma.Decimal(0)
}

export function emptyDecimalByCurrency(): DecimalByCurrency {
  return { TRY: zeroDecimal(), USD: zeroDecimal(), EUR: zeroDecimal() }
}

export function resolveKarlilikCurrency(raw: string | null | undefined): KarlilikCurrency | null {
  const pb = (raw ?? '').trim().toUpperCase()
  if (pb === 'TRY' || pb === 'USD' || pb === 'EUR') return pb
  return null
}

export function addToDecimalByCurrency(
  buckets: DecimalByCurrency,
  paraBirimi: string | null | undefined,
  amount: Prisma.Decimal
): void {
  const pb = resolveKarlilikCurrency(paraBirimi)
  if (!pb) return
  buckets[pb] = buckets[pb].plus(amount)
}

export function toMoneyByCurrency(buckets: DecimalByCurrency): MoneyByCurrency {
  return {
    TRY: moneyToApiString(buckets.TRY),
    USD: moneyToApiString(buckets.USD),
    EUR: moneyToApiString(buckets.EUR)
  }
}

export function isNonZeroDecimal(d: Prisma.Decimal): boolean {
  return !d.isZero()
}

export function moneyStringNonZero(s: string | null | undefined): boolean {
  if (s == null || s === '') return false
  try {
    return !new Prisma.Decimal(s).isZero()
  } catch {
    return false
  }
}

/** Net = gelir − gider; para birimleri karışmaz. */
export function netByCurrency(gelir: DecimalByCurrency, gider: DecimalByCurrency): DecimalByCurrency {
  return {
    TRY: gelir.TRY.minus(gider.TRY),
    USD: gelir.USD.minus(gider.USD),
    EUR: gelir.EUR.minus(gider.EUR)
  }
}

export type KarlilikOfisGelirRow = {
  tutar: Prisma.Decimal
  paraBirimi: string
}

/** GELIR + ilgili DUZELTME satırlarını para birimine göre toplar. */
export function sumKarlilikOfisGelirBuckets(
  gelirRows: KarlilikOfisGelirRow[],
  duzeltmeRows: KarlilikOfisGelirRow[]
): DecimalByCurrency {
  const buckets = emptyDecimalByCurrency()
  for (const r of gelirRows) addToDecimalByCurrency(buckets, r.paraBirimi, r.tutar)
  for (const r of duzeltmeRows) addToDecimalByCurrency(buckets, r.paraBirimi, r.tutar)
  return buckets
}
