/**
 * Ofis kasa: ekonomik tarih (düzeltme → parent.tarih) ile Decimal aggregate.
 */
import { OfisKasaIslemTipi, OfisKasaOnayDurumu, Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import {
  applyOfisIslemToAgg,
  bucketToApi,
  emptyCurrencyAgg,
  netFromBucket,
  periodBucketToApi,
  type CurrencyAggBucket
} from './currencyDecimalAgg.js'
import { PARA_BIRIMLERI, type ParaBirimiKod } from './paraBirimi.js'
import {
  financePeriodToDateFilter,
  type FinancePeriodRange
} from './financePeriodRange.js'

export type OfisAggRow = {
  id: string
  islemTipi: OfisKasaIslemTipi
  paraBirimi: ParaBirimiKod | string
  tutar: Prisma.Decimal
  tarih: Date
  orijinalHareketId: string | null
  orijinalTarih: Date | null
  onayDurumu: OfisKasaOnayDurumu
}

/** Ekonomik tarih: düzeltmede parent.tarih; yoksa self.tarih. */
export function ofisEconomicDate(r: {
  islemTipi: OfisKasaIslemTipi | string
  tarih: Date
  orijinalTarih?: Date | null
}): Date {
  if (r.islemTipi === OfisKasaIslemTipi.DUZELTME || r.islemTipi === 'DUZELTME') {
    return r.orijinalTarih ?? r.tarih
  }
  return r.tarih
}

function inPeriod(economicAt: Date, range: FinancePeriodRange | undefined): boolean {
  if (!range || (!range.bas && !range.bit)) return true
  const filter = financePeriodToDateFilter(range)
  if (!filter) return true
  if (filter.gte && economicAt < filter.gte) return false
  if (filter.lt && economicAt >= filter.lt) return false
  return true
}

export async function loadApprovedOfisRows(tenantId: string): Promise<OfisAggRow[]> {
  const rows = await prisma.ofisKasaHareketi.findMany({
    where: {
      tenantId,
      onayDurumu: OfisKasaOnayDurumu.ONAYLI,
      deletedAt: null
    },
    select: {
      id: true,
      islemTipi: true,
      paraBirimi: true,
      tutar: true,
      tarih: true,
      orijinalHareketId: true,
      onayDurumu: true,
      orijinalHareket: { select: { tarih: true } }
    }
  })
  return rows.map((r) => ({
    id: r.id,
    islemTipi: r.islemTipi,
    paraBirimi: r.paraBirimi,
    tutar: r.tutar,
    tarih: r.tarih,
    orijinalHareketId: r.orijinalHareketId,
    orijinalTarih: r.orijinalHareket?.tarih ?? null,
    onayDurumu: r.onayDurumu
  }))
}

export function aggregateOfisRows(
  rows: OfisAggRow[],
  range?: FinancePeriodRange
): Record<ParaBirimiKod, CurrencyAggBucket> {
  const buckets = emptyCurrencyAgg()
  for (const r of rows) {
    const economicAt = ofisEconomicDate(r)
    if (!inPeriod(economicAt, range)) continue
    applyOfisIslemToAgg(buckets, r.islemTipi, r.paraBirimi, r.tutar)
  }
  return buckets
}

export function lifetimeAndPeriodFromRows(
  rows: OfisAggRow[],
  period: FinancePeriodRange
): {
  lifetime: Record<ParaBirimiKod, CurrencyAggBucket>
  periodBuckets: Record<ParaBirimiKod, CurrencyAggBucket>
} {
  return {
    lifetime: aggregateOfisRows(rows),
    periodBuckets: aggregateOfisRows(rows, period)
  }
}

export { bucketToApi, periodBucketToApi, netFromBucket, PARA_BIRIMLERI }
