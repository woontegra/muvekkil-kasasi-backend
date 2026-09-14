import { ParaBirimi, Prisma } from '@prisma/client'
import { roundMoney, roundRate } from './paraBirimi.js'

const TCMB_HOST = 'www.tcmb.gov.tr'
const TODAY_PATH = '/kurlar/today.xml'
/** Bugünün bülteni bulunmuşsa uzun cache. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
/**
 * Bugün istenmiş ama TCMB henüz bugünün kurunu yayımlamamışken
 * (önceki iş günü kullanılıyorsa) kısa TTL — yeni bülten gecikmesin.
 */
const CACHE_TTL_AWAITING_TODAY_MS = 20 * 60 * 1000
const FETCH_TIMEOUT_MS = 8_000
const MAX_RETRIES = 2
const MAX_LOOKBACK_DAYS = 14

export type TcmbCurrencyQuote = {
  currency: 'USD' | 'EUR'
  buyingRate: string
  sellingRate: string
  unit: number
}

export type TcmbRatesSnapshot = {
  istenilenTarih: string
  bulunanTcmbKurTarihi: string
  effectiveDate: string
  fetchedAt: string
  source: 'TCMB'
  stale: boolean
  fallbackKullanildi: boolean
  usd: TcmbCurrencyQuote
  eur: TcmbCurrencyQuote
  /** 1 USD = X EUR (TRY kurlarından Decimal) */
  usdEurCapraz: string
  /** 1 EUR = X USD */
  eurUsdCapraz: string
}

export type TcmbPairQuote = {
  istenilenTarih: string
  bulunanTcmbKurTarihi: string
  bazParaBirimi: ParaBirimi
  karsiParaBirimi: ParaBirimi
  /** Döviz Alış referansı — 1 baz = rate karşı */
  dovizAlis: string
  dovizSatis: string | null
  kaynak: 'TCMB'
  fallbackKullanildi: boolean
  stale: boolean
  fetchedAt: string
}

type CacheEntry = {
  expiresAt: number
  snapshot: TcmbRatesSnapshot
}

const memoryCache = new Map<string, CacheEntry>()
/** Son başarılı snapshot — TCMB down iken stale gösterim için. */
let lastSuccessful: TcmbRatesSnapshot | null = null

export type TcmbFetchFn = (url: string) => Promise<string>

function assertTcmbUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Geçersiz TCMB URL.')
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== TCMB_HOST) {
    throw new Error('Yalnızca TCMB adreslerine erişilir.')
  }
  if (!parsed.pathname.startsWith('/kurlar/')) {
    throw new Error('Geçersiz TCMB kur yolu.')
  }
}

/** XXE kapalı: harici entity yok; yalnızca bilinen etiket regex ile okunur. */
export function parseTcmbXml(xml: string): {
  tarih: string
  usdBuying: Prisma.Decimal
  usdSelling: Prisma.Decimal
  eurBuying: Prisma.Decimal
  eurSelling: Prisma.Decimal
  usdUnit: number
  eurUnit: number
} {
  if (/<!ENTITY/i.test(xml) || /SYSTEM\s+["']/i.test(xml)) {
    throw new Error('XML içinde harici entity yasaktır.')
  }
  const dateMatch =
    /Tarih_Date[^>]*\sTarih="(\d{2}\.\d{2}\.\d{4})"/i.exec(xml) ??
    /Date="(\d{2}\/\d{2}\/\d{4})"/i.exec(xml)
  if (!dateMatch?.[1]) throw new Error('TCMB kur tarihi okunamadı.')
  const rawDate = dateMatch[1].includes('/')
    ? dateMatch[1].replace(/\//g, '.')
    : dateMatch[1]
  const [dd, mm, yyyy] = rawDate.split('.')
  const tarih = `${yyyy}-${mm}-${dd}`

  function extractCurrency(code: 'USD' | 'EUR') {
    const block =
      new RegExp(
        `<Currency[^>]*CurrencyCode="${code}"[^>]*>([\\s\\S]*?)</Currency>`,
        'i'
      ).exec(xml)?.[1] ??
      new RegExp(`<Currency[^>]*Kod="${code}"[^>]*>([\\s\\S]*?)</Currency>`, 'i').exec(xml)?.[1]
    if (!block) throw new Error(`${code} kuru bulunamadı.`)
    const unitRaw = /<Unit>([^<]+)<\/Unit>/i.exec(block)?.[1]?.trim() ?? '1'
    const buyingRaw = /<ForexBuying>([^<]*)<\/ForexBuying>/i.exec(block)?.[1]?.trim()
    const sellingRaw = /<ForexSelling>([^<]*)<\/ForexSelling>/i.exec(block)?.[1]?.trim()
    if (!buyingRaw || !sellingRaw) throw new Error(`${code} Döviz Alış/Satış okunamadı.`)
    const unit = Number.parseInt(unitRaw, 10) || 1
    const buying = new Prisma.Decimal(buyingRaw.replace(',', '.')).div(unit)
    const selling = new Prisma.Decimal(sellingRaw.replace(',', '.')).div(unit)
    return { buying: roundRate(buying), selling: roundRate(selling), unit }
  }

  const usd = extractCurrency('USD')
  const eur = extractCurrency('EUR')
  return {
    tarih,
    usdBuying: usd.buying,
    usdSelling: usd.selling,
    eurBuying: eur.buying,
    eurSelling: eur.selling,
    usdUnit: usd.unit,
    eurUnit: eur.unit
  }
}

export function buildTcmbHistoricalUrl(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) throw new Error('Tarih YYYY-MM-DD olmalıdır.')
  const [, y, mo, d] = m
  // https://www.tcmb.gov.tr/kurlar/YYYYMM/DDMMYYYY.xml
  return `https://${TCMB_HOST}/kurlar/${y}${mo}/${d}${mo}${y}.xml`
}

export function buildTcmbTodayUrl(): string {
  return `https://${TCMB_HOST}${TODAY_PATH}`
}

function toYmd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYmdUtc(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) throw new Error('Tarih YYYY-MM-DD olmalıdır.')
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

function addDaysYmd(ymd: string, delta: number): string {
  const d = parseYmdUtc(ymd)
  d.setUTCDate(d.getUTCDate() + delta)
  return toYmd(d)
}

async function defaultFetch(url: string): Promise<string> {
  assertTcmbUrl(url)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    let lastErr: unknown
    for (let i = 0; i <= MAX_RETRIES; i++) {
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { Accept: 'application/xml,text/xml,*/*' }
        })
        if (!res.ok) throw new Error(`TCMB HTTP ${res.status}`)
        return await res.text()
      } catch (e) {
        lastErr = e
        if (i < MAX_RETRIES) await new Promise((r) => setTimeout(r, 300 * (i + 1)))
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('TCMB erişilemedi.')
  } finally {
    clearTimeout(timer)
  }
}

function buildSnapshot(
  istenilenTarih: string,
  parsed: ReturnType<typeof parseTcmbXml>,
  fallbackKullanildi: boolean,
  stale: boolean
): TcmbRatesSnapshot {
  const usdEur = roundRate(parsed.usdBuying.div(parsed.eurBuying))
  const eurUsd = roundRate(parsed.eurBuying.div(parsed.usdBuying))
  return {
    istenilenTarih,
    bulunanTcmbKurTarihi: parsed.tarih,
    effectiveDate: parsed.tarih,
    fetchedAt: new Date().toISOString(),
    source: 'TCMB',
    stale,
    fallbackKullanildi,
    usd: {
      currency: 'USD',
      buyingRate: parsed.usdBuying.toFixed(8),
      sellingRate: parsed.usdSelling.toFixed(8),
      unit: 1
    },
    eur: {
      currency: 'EUR',
      buyingRate: parsed.eurBuying.toFixed(8),
      sellingRate: parsed.eurSelling.toFixed(8),
      unit: 1
    },
    usdEurCapraz: usdEur.toFixed(8),
    eurUsdCapraz: eurUsd.toFixed(8)
  }
}

export type GetTcmbRatesOptions = {
  date?: string
  fetchXml?: TcmbFetchFn
  /** Test / manuel yenileme: bellek cache’ini atla, TCMB kaynağını yeniden sorgula */
  bypassCache?: boolean
  /** API `forceRefresh=true` — bypassCache ile aynı */
  forceRefresh?: boolean
  now?: Date
}

/**
 * İstenen tarih için TCMB kurları. Yoksa geriye doğru iş günü arar.
 * Başarısız olursa son başarılı cache’i stale=true ile döner; hiç yoksa null.
 */
export async function getTcmbRates(
  opts: GetTcmbRatesOptions = {}
): Promise<TcmbRatesSnapshot | null> {
  const now = opts.now ?? new Date()
  const istenilen =
    opts.date?.trim() ||
    toYmd(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())))
  const cacheKey = istenilen
  const skipCache = Boolean(opts.bypassCache || opts.forceRefresh)
  if (!skipCache) {
    const hit = memoryCache.get(cacheKey)
    if (hit && hit.expiresAt > Date.now()) return hit.snapshot
  }

  const fetchXml = opts.fetchXml ?? defaultFetch
  const todayYmd = toYmd(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())))
  let lastError: unknown

  for (let i = 0; i <= MAX_LOOKBACK_DAYS; i++) {
    const candidate = addDaysYmd(istenilen, -i)
    const url =
      candidate === todayYmd && i === 0 ? buildTcmbTodayUrl() : buildTcmbHistoricalUrl(candidate)
    try {
      const xml = await fetchXml(url)
      const parsed = parseTcmbXml(xml)
      // fallbackKullanildi: istenen günde bülten yok → önceki iş günü (stale DEĞİL).
      // stale: yalnızca TCMB erişilemezken eski bellek cache’i.
      const fallbackKullanildi = parsed.tarih !== istenilen
      const snap = buildSnapshot(istenilen, parsed, fallbackKullanildi, false)
      // Bugün bekleniyor ama bülten henüz yoksa kısa cache; aksi halde 6 saat.
      const awaitingTodayBulletin = istenilen === todayYmd && fallbackKullanildi
      const ttl = awaitingTodayBulletin ? CACHE_TTL_AWAITING_TODAY_MS : CACHE_TTL_MS
      memoryCache.set(cacheKey, { expiresAt: Date.now() + ttl, snapshot: snap })
      lastSuccessful = snap
      return snap
    } catch (e) {
      lastError = e
      continue
    }
  }

  if (lastSuccessful) {
    return {
      ...lastSuccessful,
      istenilenTarih: istenilen,
      stale: true,
      fallbackKullanildi: true,
      fetchedAt: lastSuccessful.fetchedAt
    }
  }

  void lastError
  return null
}

/** 1 baz = rate karşı (Döviz Alış varsayılan). */
export async function getTcmbPairRate(
  baz: ParaBirimi,
  karsi: ParaBirimi,
  opts: GetTcmbRatesOptions = {}
): Promise<TcmbPairQuote | null> {
  if (baz === karsi) {
    return {
      istenilenTarih: opts.date ?? toYmd(new Date()),
      bulunanTcmbKurTarihi: opts.date ?? toYmd(new Date()),
      bazParaBirimi: baz,
      karsiParaBirimi: karsi,
      dovizAlis: '1.00000000',
      dovizSatis: '1.00000000',
      kaynak: 'TCMB',
      fallbackKullanildi: false,
      stale: false,
      fetchedAt: new Date().toISOString()
    }
  }
  const snap = await getTcmbRates(opts)
  if (!snap) return null

  const usdTry = new Prisma.Decimal(snap.usd.buyingRate)
  const eurTry = new Prisma.Decimal(snap.eur.buyingRate)
  const usdTrySell = new Prisma.Decimal(snap.usd.sellingRate)
  const eurTrySell = new Prisma.Decimal(snap.eur.sellingRate)

  let alis: Prisma.Decimal
  let satis: Prisma.Decimal | null

  if (baz === ParaBirimi.USD && karsi === ParaBirimi.TRY) {
    alis = usdTry
    satis = usdTrySell
  } else if (baz === ParaBirimi.EUR && karsi === ParaBirimi.TRY) {
    alis = eurTry
    satis = eurTrySell
  } else if (baz === ParaBirimi.TRY && karsi === ParaBirimi.USD) {
    alis = roundRate(new Prisma.Decimal(1).div(usdTry))
    satis = roundRate(new Prisma.Decimal(1).div(usdTrySell))
  } else if (baz === ParaBirimi.TRY && karsi === ParaBirimi.EUR) {
    alis = roundRate(new Prisma.Decimal(1).div(eurTry))
    satis = roundRate(new Prisma.Decimal(1).div(eurTrySell))
  } else if (baz === ParaBirimi.USD && karsi === ParaBirimi.EUR) {
    alis = roundRate(usdTry.div(eurTry))
    satis = roundRate(usdTrySell.div(eurTrySell))
  } else if (baz === ParaBirimi.EUR && karsi === ParaBirimi.USD) {
    alis = roundRate(eurTry.div(usdTry))
    satis = roundRate(eurTrySell.div(usdTrySell))
  } else {
    return null
  }

  return {
    istenilenTarih: snap.istenilenTarih,
    bulunanTcmbKurTarihi: snap.bulunanTcmbKurTarihi,
    bazParaBirimi: baz,
    karsiParaBirimi: karsi,
    dovizAlis: alis.toFixed(8),
    dovizSatis: satis?.toFixed(8) ?? null,
    kaynak: 'TCMB',
    fallbackKullanildi: snap.fallbackKullanildi,
    stale: snap.stale,
    fetchedAt: snap.fetchedAt
  }
}

/** Ödeme PB → TRY prim matrahı (Decimal). Snapshot için işlem anında çağrılır. */
export function computePrimTryMatrahi(opts: {
  odemeParaBirimi: ParaBirimi
  kasaTutari: Prisma.Decimal
  /** 1 odemePB = X TRY (TCMB alış veya uygulanan) */
  odemePbTryRate: Prisma.Decimal | null
}): Prisma.Decimal {
  if (opts.odemeParaBirimi === ParaBirimi.TRY) {
    return roundMoney(opts.kasaTutari)
  }
  if (!opts.odemePbTryRate || opts.odemePbTryRate.lte(0)) {
    throw new Error('Yabancı para prim matrahı için TRY kuru gerekli.')
  }
  return roundMoney(opts.kasaTutari.mul(opts.odemePbTryRate))
}

export function clearTcmbCacheForTests(): void {
  memoryCache.clear()
  lastSuccessful = null
}

export function seedTcmbCacheForTests(snapshot: TcmbRatesSnapshot): void {
  lastSuccessful = snapshot
  memoryCache.set(snapshot.istenilenTarih, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    snapshot
  })
}

export { CACHE_TTL_MS as TCMB_CACHE_TTL_MS, CACHE_TTL_AWAITING_TODAY_MS as TCMB_CACHE_TTL_AWAITING_TODAY_MS }
