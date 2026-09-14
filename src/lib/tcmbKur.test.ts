import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, beforeEach } from 'node:test'
import { ParaBirimi, Prisma } from '@prisma/client'
import {
  buildTcmbHistoricalUrl,
  buildTcmbTodayUrl,
  clearTcmbCacheForTests,
  computePrimTryMatrahi,
  getTcmbPairRate,
  getTcmbRates,
  parseTcmbXml,
  seedTcmbCacheForTests
} from './tcmbKur.service.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const xml10 = readFileSync(join(__dir, '__fixtures__/tcmb-2026-09-10.xml'), 'utf8')
const xml11 = readFileSync(join(__dir, '__fixtures__/tcmb-2026-09-11.xml'), 'utf8')

describe('parseTcmbXml', () => {
  it('parses USD/EUR ForexBuying and date', () => {
    const p = parseTcmbXml(xml11)
    assert.equal(p.tarih, '2026-09-11')
    assert.equal(p.usdBuying.toFixed(8), '34.80000000')
    assert.equal(p.eurBuying.toFixed(8), '37.50000000')
  })

  it('rejects XXE entity declarations', () => {
    assert.throws(() => parseTcmbXml('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml11))
  })
})

describe('TCMB URL builders', () => {
  it('builds today and historical URLs on tcmb.gov.tr only', () => {
    assert.equal(buildTcmbTodayUrl(), 'https://www.tcmb.gov.tr/kurlar/today.xml')
    assert.equal(buildTcmbHistoricalUrl('2026-09-10'), 'https://www.tcmb.gov.tr/kurlar/202609/10092026.xml')
  })
})

describe('getTcmbRates with fixtures', () => {
  beforeEach(() => clearTcmbCacheForTests())

  it('returns today USD/EUR buying rates', async () => {
    const snap = await getTcmbRates({
      date: '2026-09-11',
      bypassCache: true,
      now: new Date('2026-09-11T12:00:00+03:00'),
      fetchXml: async (url) => {
        if (url.includes('today.xml') || url.includes('11092026')) return xml11
        throw new Error('404')
      }
    })
    assert.ok(snap)
    assert.equal(snap!.usd.buyingRate, '34.80000000')
    assert.equal(snap!.eur.buyingRate, '37.50000000')
    assert.equal(snap!.source, 'TCMB')
    assert.equal(snap!.stale, false)
  })

  it('weekend falls back to previous business day', async () => {
    // Saturday 2026-09-12 → look back to 2026-09-11
    const snap = await getTcmbRates({
      date: '2026-09-12',
      bypassCache: true,
      now: new Date('2026-09-12T12:00:00+03:00'),
      fetchXml: async (url) => {
        if (url.includes('12092026')) throw new Error('404')
        if (url.includes('11092026') || url.includes('today.xml')) return xml11
        throw new Error('404')
      }
    })
    assert.ok(snap)
    assert.equal(snap!.istenilenTarih, '2026-09-12')
    assert.equal(snap!.bulunanTcmbKurTarihi, '2026-09-11')
    assert.equal(snap!.fallbackKullanildi, true)
  })

  it('computes USD/EUR cross from TRY rates with Decimal', async () => {
    const snap = await getTcmbRates({
      date: '2026-09-10',
      bypassCache: true,
      fetchXml: async () => xml10
    })
    assert.ok(snap)
    // 34.5 / 37.2
    const expected = new Prisma.Decimal('34.5').div('37.2').toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP)
    assert.equal(snap!.usdEurCapraz, expected.toFixed(8))
  })

  it('returns stale cache when TCMB unreachable', async () => {
    seedTcmbCacheForTests({
      istenilenTarih: '2026-09-10',
      bulunanTcmbKurTarihi: '2026-09-10',
      effectiveDate: '2026-09-10',
      fetchedAt: '2026-09-10T10:00:00.000Z',
      lastCheckedAt: '2026-09-10T10:00:00.000Z',
      fromCache: false,
      source: 'TCMB',
      stale: false,
      fallbackKullanildi: false,
      usd: { currency: 'USD', buyingRate: '34.50000000', sellingRate: '34.60000000', unit: 1 },
      eur: { currency: 'EUR', buyingRate: '37.20000000', sellingRate: '37.35000000', unit: 1 },
      usdEurCapraz: '0.92741935',
      eurUsdCapraz: '1.07826087'
    })
    clearTcmbCacheForTests()
    // re-seed lastSuccessful only via get failure path — seed again after clear
    seedTcmbCacheForTests({
      istenilenTarih: '2026-09-10',
      bulunanTcmbKurTarihi: '2026-09-10',
      effectiveDate: '2026-09-10',
      fetchedAt: '2026-09-10T10:00:00.000Z',
      lastCheckedAt: '2026-09-10T10:00:00.000Z',
      fromCache: false,
      source: 'TCMB',
      stale: false,
      fallbackKullanildi: false,
      usd: { currency: 'USD', buyingRate: '34.50000000', sellingRate: '34.60000000', unit: 1 },
      eur: { currency: 'EUR', buyingRate: '37.20000000', sellingRate: '37.35000000', unit: 1 },
      usdEurCapraz: '0.92741935',
      eurUsdCapraz: '1.07826087'
    })
    const snap = await getTcmbRates({
      date: '2026-09-11',
      bypassCache: true,
      fetchXml: async () => {
        throw new Error('network down')
      }
    })
    assert.ok(snap)
    assert.equal(snap!.stale, true)
    assert.equal(snap!.usd.buyingRate, '34.50000000')
  })

  it('returns null when no cache and TCMB down', async () => {
    clearTcmbCacheForTests()
    const snap = await getTcmbRates({
      date: '2026-09-11',
      bypassCache: true,
      fetchXml: async () => {
        throw new Error('down')
      }
    })
    assert.equal(snap, null)
  })

  it('forceRefresh skips memory cache and re-fetches TCMB', async () => {
    seedTcmbCacheForTests({
      istenilenTarih: '2026-09-11',
      bulunanTcmbKurTarihi: '2026-09-11',
      effectiveDate: '2026-09-11',
      fetchedAt: '2026-09-11T10:00:00.000Z',
      lastCheckedAt: '2026-09-11T10:00:00.000Z',
      fromCache: false,
      source: 'TCMB',
      stale: false,
      fallbackKullanildi: false,
      usd: { currency: 'USD', buyingRate: '30.00000000', sellingRate: '30.10000000', unit: 1 },
      eur: { currency: 'EUR', buyingRate: '33.00000000', sellingRate: '33.10000000', unit: 1 },
      usdEurCapraz: '0.90909091',
      eurUsdCapraz: '1.10000000'
    })

    let fetchCount = 0
    const cached = await getTcmbRates({
      date: '2026-09-11',
      now: new Date('2026-09-11T12:00:00+03:00'),
      fetchXml: async () => {
        fetchCount += 1
        return xml11
      }
    })
    assert.equal(fetchCount, 0)
    assert.equal(cached!.usd.buyingRate, '30.00000000')
    assert.equal(cached!.fromCache, true)

    const forced = await getTcmbRates({
      date: '2026-09-11',
      forceRefresh: true,
      now: new Date('2026-09-11T12:00:00+03:00'),
      fetchXml: async () => {
        fetchCount += 1
        return xml11
      }
    })
    assert.equal(fetchCount, 1)
    assert.equal(forced!.usd.buyingRate, '34.80000000')
    assert.equal(forced!.stale, false)
    assert.equal(forced!.fromCache, false)
  })

  it('concurrent callers share a single TCMB fetch (singleflight)', async () => {
    let fetchCount = 0
    let release!: (xml: string) => void
    const gate = new Promise<string>((resolve) => {
      release = resolve
    })
    const fetchXml = async () => {
      fetchCount += 1
      return gate
    }

    const p1 = getTcmbRates({
      date: '2026-09-11',
      now: new Date('2026-09-11T12:00:00+03:00'),
      fetchXml
    })
    const p2 = getTcmbRates({
      date: '2026-09-11',
      now: new Date('2026-09-11T12:00:00+03:00'),
      fetchXml
    })
    release(xml11)
    const [a, b] = await Promise.all([p1, p2])
    assert.equal(fetchCount, 1)
    assert.equal(a!.usd.buyingRate, '34.80000000')
    assert.equal(b!.usd.buyingRate, '34.80000000')
  })

  it('serves memory cache within 60m without TCMB hit', async () => {
    let fetchCount = 0
    await getTcmbRates({
      date: '2026-09-11',
      now: new Date('2026-09-11T12:00:00+03:00'),
      fetchXml: async () => {
        fetchCount += 1
        return xml11
      }
    })
    assert.equal(fetchCount, 1)
    const again = await getTcmbRates({
      date: '2026-09-11',
      now: new Date('2026-09-11T12:30:00+03:00'),
      fetchXml: async () => {
        fetchCount += 1
        return xml11
      }
    })
    assert.equal(fetchCount, 1)
    assert.equal(again!.fromCache, true)
  })

  it('afternoon 16:35 refresh once when today bulletin missing', async () => {
    seedTcmbCacheForTests({
      istenilenTarih: '2026-09-11',
      bulunanTcmbKurTarihi: '2026-09-10',
      effectiveDate: '2026-09-10',
      fetchedAt: '2026-09-11T10:00:00.000Z',
      lastCheckedAt: '2026-09-11T10:00:00.000Z',
      fromCache: false,
      source: 'TCMB',
      stale: false,
      fallbackKullanildi: true,
      usd: { currency: 'USD', buyingRate: '30.00000000', sellingRate: '30.10000000', unit: 1 },
      eur: { currency: 'EUR', buyingRate: '33.00000000', sellingRate: '33.10000000', unit: 1 },
      usdEurCapraz: '0.90909091',
      eurUsdCapraz: '1.10000000'
    })

    let fetchCount = 0
    const snap = await getTcmbRates({
      date: '2026-09-11',
      now: new Date('2026-09-11T16:40:00+03:00'),
      fetchXml: async () => {
        fetchCount += 1
        return xml11
      }
    })
    assert.equal(fetchCount, 1)
    assert.equal(snap!.bulunanTcmbKurTarihi, '2026-09-11')
    assert.equal(snap!.fromCache, false)

    const again = await getTcmbRates({
      date: '2026-09-11',
      now: new Date('2026-09-11T16:50:00+03:00'),
      fetchXml: async () => {
        fetchCount += 1
        return xml11
      }
    })
    // Cache TTL still valid after live fetch — no second TCMB
    assert.equal(fetchCount, 1)
    assert.equal(again!.fromCache, true)
  })
})

describe('getTcmbPairRate', () => {
  beforeEach(() => clearTcmbCacheForTests())

  it('USD/TRY EUR/TRY and USD/EUR pairs', async () => {
    const fetchXml = async () => xml11
    const usdTry = await getTcmbPairRate(ParaBirimi.USD, ParaBirimi.TRY, {
      date: '2026-09-11',
      bypassCache: true,
      fetchXml
    })
    const eurTry = await getTcmbPairRate(ParaBirimi.EUR, ParaBirimi.TRY, {
      date: '2026-09-11',
      bypassCache: true,
      fetchXml
    })
    const usdEur = await getTcmbPairRate(ParaBirimi.USD, ParaBirimi.EUR, {
      date: '2026-09-11',
      bypassCache: true,
      fetchXml
    })
    assert.equal(usdTry!.dovizAlis, '34.80000000')
    assert.equal(eurTry!.dovizAlis, '37.50000000')
    const expected = new Prisma.Decimal('34.8').div('37.5').toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP)
    assert.equal(usdEur!.dovizAlis, expected.toFixed(8))
  })
})

describe('computePrimTryMatrahi', () => {
  it('TRY kasa uses amount directly', () => {
    const m = computePrimTryMatrahi({
      odemeParaBirimi: ParaBirimi.TRY,
      kasaTutari: new Prisma.Decimal('48000'),
      odemePbTryRate: null
    })
    assert.equal(m.toFixed(2), '48000.00')
  })

  it('USD kasa uses TCMB TRY rate snapshot', () => {
    const m = computePrimTryMatrahi({
      odemeParaBirimi: ParaBirimi.USD,
      kasaTutari: new Prisma.Decimal('100'),
      odemePbTryRate: new Prisma.Decimal('34.80000000')
    })
    assert.equal(m.toFixed(2), '3480.00')
  })
})
