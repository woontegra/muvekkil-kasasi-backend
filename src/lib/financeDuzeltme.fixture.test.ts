import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { computeBalanceImpact, computeEskiYeniTutar } from './duzeltmeBalanceImpact.js'
import {
  flattenGroupedFinanceRows,
  groupDuzeltmeWithParents,
  type DuzeltmeGroupable
} from './duzeltmeGrouping.js'
import { resolveFinancePeriodRange, coercePresetForManualDates } from './financePeriodRange.js'
import { applyOfisIslemToAgg, emptyCurrencyAgg, netFromBucket } from './currencyDecimalAgg.js'
import { ofisEconomicDate, aggregateOfisRows } from './ofisKasaEconomicAgg.js'
import { OfisKasaIslemTipi, OfisKasaOnayDurumu } from '@prisma/client'

describe('financePeriodRange', () => {
  const now = new Date('2026-09-22T12:00:00+03:00')

  it('Bu Ay: ayın ilk günü → bugün', () => {
    const r = resolveFinancePeriodRange('THIS_MONTH', { now })
    expect(r.bas).toBe('2026-09-01')
    expect(r.bit).toBe('2026-09-22')
  })

  it('Geçen Ay: önceki takvim ayı tamamı', () => {
    const r = resolveFinancePeriodRange('LAST_MONTH', { now })
    expect(r.bas).toBe('2026-08-01')
    expect(r.bit).toBe('2026-08-31')
  })

  it('Bu Yıl: 1 Ocak → bugün', () => {
    const r = resolveFinancePeriodRange('THIS_YEAR', { now })
    expect(r.bas).toBe('2026-01-01')
    expect(r.bit).toBe('2026-09-22')
  })

  it('Tüm Zamanlar: null sınır', () => {
    const r = resolveFinancePeriodRange('ALL_TIME', { now })
    expect(r.bas).toBeNull()
    expect(r.bit).toBeNull()
  })

  it('manuel tarih → CUSTOM', () => {
    expect(coercePresetForManualDates('2026-01-05', '2026-01-10', now)).toBe('CUSTOM')
  })
})

describe('duzeltmeBalanceImpact', () => {
  it('+ TRY / − USD / sıfır', () => {
    expect(computeBalanceImpact(500, 'TRY').display).toBe('+500,00\u00A0₺')
    expect(computeBalanceImpact(-500, 'USD').display).toBe('\u2212$500,00')
    expect(computeBalanceImpact(0, 'EUR').display).toBe('€0,00')
    expect(computeBalanceImpact(500, 'TRY').sign).toBe('positive')
    expect(computeBalanceImpact(-500, 'TRY').sign).toBe('negative')
  })

  it('eski → yeni GELIR/GIDER', () => {
    expect(
      computeEskiYeniTutar({
        orijinalTutar: 65000,
        duzeltmeTutar: 500,
        orijinalTip: 'GELIR'
      })
    ).toEqual({ eskiTutar: '65000.00', yeniTutar: '65500.00' })
    expect(
      computeEskiYeniTutar({
        orijinalTutar: 71000,
        duzeltmeTutar: 500,
        orijinalTip: 'GIDER'
      })
    ).toEqual({ eskiTutar: '71000.00', yeniTutar: '70500.00' })
  })
})

describe('duzeltmeGrouping', () => {
  it('düzeltme parent hemen üstünde; ekonomik tarihe göre sıralı', () => {
    const aug = new Date('2026-08-15T12:00:00+03:00')
    const sep = new Date('2026-09-10T12:00:00+03:00')
    const rows: DuzeltmeGroupable[] = [
      {
        id: 'p1',
        isDuzeltme: false,
        orijinalHareketId: null,
        economicAt: aug,
        createdAt: aug,
        duzeltmeAt: null
      },
      {
        id: 'c1',
        isDuzeltme: true,
        orijinalHareketId: 'p1',
        economicAt: aug,
        createdAt: sep,
        duzeltmeAt: sep
      },
      {
        id: 'p2',
        isDuzeltme: false,
        orijinalHareketId: null,
        economicAt: sep,
        createdAt: sep,
        duzeltmeAt: null
      }
    ]
    const flat = flattenGroupedFinanceRows(groupDuzeltmeWithParents(rows))
    expect(flat.map((r) => r.id)).toEqual(['p2', 'c1', 'p1'])
  })

  it('orphan düzeltme uyarısı', () => {
    const t = new Date('2026-09-01T12:00:00+03:00')
    const g = groupDuzeltmeWithParents([
      {
        id: 'orphan',
        isDuzeltme: true,
        orijinalHareketId: null,
        economicAt: t,
        createdAt: t,
        duzeltmeAt: t
      }
    ])
    expect(g[0]!.orphanWarning).toBe(true)
  })
})

describe('fixture net bakiyeler (Decimal, para birimi karışmaz)', () => {
  it('TRY 65000 +500 -71000 = -5500; USD 15000', () => {
    const buckets = emptyCurrencyAgg()
    applyOfisIslemToAgg(buckets, 'GELIR', 'TRY', new Prisma.Decimal(65000))
    applyOfisIslemToAgg(buckets, 'DUZELTME', 'TRY', new Prisma.Decimal(500))
    applyOfisIslemToAgg(buckets, 'GIDER', 'TRY', new Prisma.Decimal(71000))
    applyOfisIslemToAgg(buckets, 'GELIR', 'USD', new Prisma.Decimal(15000))
    expect(netFromBucket(buckets.TRY).toFixed(2)).toBe('-5500.00')
    expect(netFromBucket(buckets.USD).toFixed(2)).toBe('15000.00')
    expect(netFromBucket(buckets.EUR).toFixed(2)).toBe('0.00')
  })

  it('Ağustos hareketi eylül düzeltmesi → ekonomik dönem ağustos', () => {
    const aug = new Date('2026-08-10T12:00:00+03:00')
    const sep = new Date('2026-09-05T12:00:00+03:00')
    const rows = [
      {
        id: '1',
        islemTipi: OfisKasaIslemTipi.GELIR,
        paraBirimi: 'TRY',
        tutar: new Prisma.Decimal(7500),
        tarih: aug,
        orijinalHareketId: null,
        orijinalTarih: null,
        onayDurumu: OfisKasaOnayDurumu.ONAYLI
      },
      {
        id: '2',
        islemTipi: OfisKasaIslemTipi.DUZELTME,
        paraBirimi: 'TRY',
        tutar: new Prisma.Decimal(500),
        tarih: sep,
        orijinalHareketId: '1',
        orijinalTarih: aug,
        onayDurumu: OfisKasaOnayDurumu.ONAYLI
      },
      {
        id: '3',
        islemTipi: OfisKasaIslemTipi.GELIR,
        paraBirimi: 'USD',
        tutar: new Prisma.Decimal(15000),
        tarih: sep,
        orijinalHareketId: null,
        orijinalTarih: null,
        onayDurumu: OfisKasaOnayDurumu.ONAYLI
      }
    ]
    expect(ofisEconomicDate(rows[1]!).getTime()).toBe(aug.getTime())

    const august = resolveFinancePeriodRange('CUSTOM', {
      bas: '2026-08-01',
      bit: '2026-08-31'
    })
    const sepRange = resolveFinancePeriodRange('CUSTOM', {
      bas: '2026-09-01',
      bit: '2026-09-30'
    })
    const augAgg = aggregateOfisRows(rows, august)
    const sepAgg = aggregateOfisRows(rows, sepRange)
    expect(augAgg.TRY.gelir.toFixed(2)).toBe('7500.00')
    expect(augAgg.TRY.duzeltme.toFixed(2)).toBe('500.00')
    expect(sepAgg.TRY.gelir.toFixed(2)).toBe('0.00')
    expect(sepAgg.TRY.duzeltme.toFixed(2)).toBe('0.00')
    expect(sepAgg.USD.gelir.toFixed(2)).toBe('15000.00')
  })
})
