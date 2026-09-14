import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { resolveParaBirimi } from '../lib/paraBirimi.js'
import { getTcmbPairRate, getTcmbRates } from '../lib/tcmbKur.service.js'
import { computeYaklasikTryBatch, resolveCaprazHesapFields } from '../lib/tcmbYaklasikTry.js'

export const kurlarRouter = Router()

const dateQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-MM-DD olmalıdır.')
    .optional(),
  forceRefresh: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true')
})

const pairQuery = dateQuery.extend({
  baz: z.enum(['TRY', 'USD', 'EUR']).default('USD'),
  karsi: z.enum(['TRY', 'USD', 'EUR']).default('TRY')
})

/**
 * GET /kurlar/tcmb?date=YYYY-MM-DD&forceRefresh=true
 * Üst bar + form referansı — Döviz Alış varsayılan.
 * forceRefresh: uygulama bellek cache’ini atlar, TCMB kaynağını yeniden sorgular.
 */
kurlarRouter.get('/tcmb', requireAuth, async (req, res, next) => {
  try {
    const q = dateQuery.parse(req.query)
    const snap = await getTcmbRates({
      date: q.date,
      forceRefresh: q.forceRefresh === true
    })
    if (!snap) {
      res.json({
        ok: true,
        available: false,
        message: 'Kur bilgisi alınamadı',
        rates: null
      })
      return
    }
    res.json({
      ok: true,
      available: true,
      istenilenTarih: snap.istenilenTarih,
      bulunanTcmbKurTarihi: snap.bulunanTcmbKurTarihi,
      effectiveDate: snap.effectiveDate,
      fetchedAt: snap.fetchedAt,
      source: snap.source,
      sourceLabel: 'Türkiye Cumhuriyet Merkez Bankası',
      stale: snap.stale,
      fallbackKullanildi: snap.fallbackKullanildi,
      /** stale ≠ fallback: önceki iş günü seçimi stale değildir. */
      cacheNote: snap.fallbackKullanildi && !snap.stale
        ? 'İstenen günde TCMB bülteni yok; önceki iş günü kuru kullanıldı (güncel referans, stale değil).'
        : snap.stale
          ? 'TCMB erişilemedi; son alınan kur gösteriliyor.'
          : null,
      usdDovizAlis: snap.usd.buyingRate,
      usdDovizSatis: snap.usd.sellingRate,
      eurDovizAlis: snap.eur.buyingRate,
      eurDovizSatis: snap.eur.sellingRate,
      usdEurCapraz: snap.usdEurCapraz,
      eurUsdCapraz: snap.eurUsdCapraz,
      rates: [
        {
          currency: 'USD',
          buyingRate: snap.usd.buyingRate,
          sellingRate: snap.usd.sellingRate,
          effectiveDate: snap.effectiveDate,
          fetchedAt: snap.fetchedAt,
          source: 'TCMB',
          stale: snap.stale
        },
        {
          currency: 'EUR',
          buyingRate: snap.eur.buyingRate,
          sellingRate: snap.eur.sellingRate,
          effectiveDate: snap.effectiveDate,
          fetchedAt: snap.fetchedAt,
          source: 'TCMB',
          stale: snap.stale
        }
      ]
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /kurlar/tcmb/capraz?baz=USD&karsi=TRY&date=YYYY-MM-DD
 */
kurlarRouter.get('/tcmb/capraz', requireAuth, async (req, res, next) => {
  try {
    const q = pairQuery.parse(req.query)
    const baz = resolveParaBirimi(q.baz)
    const karsi = resolveParaBirimi(q.karsi)
    const pair = await getTcmbPairRate(baz, karsi, {
      date: q.date,
      forceRefresh: q.forceRefresh === true
    })
    if (!pair) {
      res.json({
        ok: true,
        available: false,
        message: 'TCMB kuru alınamadı, uygulanacak kuru manuel giriniz',
        quote: null
      })
      return
    }
    res.json({
      ok: true,
      available: true,
      istenilenTarih: pair.istenilenTarih,
      bulunanTcmbKurTarihi: pair.bulunanTcmbKurTarihi,
      bazParaBirimi: pair.bazParaBirimi,
      karsiParaBirimi: pair.karsiParaBirimi,
      hesaplananCaprazKur: pair.dovizAlis,
      dovizAlis: pair.dovizAlis,
      dovizSatis: pair.dovizSatis,
      kaynak: pair.kaynak,
      fallbackKullanildi: pair.fallbackKullanildi,
      stale: pair.stale,
      fetchedAt: pair.fetchedAt,
      quote: pair
    })
  } catch (e) {
    next(e)
  }
})

const yaklasikTryBody = z.object({
  paraBirimi: z.enum(['TRY', 'USD', 'EUR']),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(120),
        tutar: z.union([z.string(), z.number()])
      })
    )
    .max(200)
})

/**
 * POST /kurlar/tcmb/yaklasik-try
 * Tek TCMB çağrısı + Decimal — gösterim amaçlı yaklaşık TRY (borca yazılmaz).
 */
kurlarRouter.post('/tcmb/yaklasik-try', requireAuth, async (req, res, next) => {
  try {
    const body = yaklasikTryBody.parse(req.body)
    const result = await computeYaklasikTryBatch(body)
    res.json({ ok: true, ...result })
  } catch (e) {
    next(e)
  }
})

const caprazHesapBody = z.object({
  alacakParaBirimi: z.enum(['TRY', 'USD', 'EUR']),
  odemeParaBirimi: z.enum(['TRY', 'USD', 'EUR']),
  mahsupTutari: z.union([z.string(), z.number()]).optional(),
  kasaTutari: z.union([z.string(), z.number()]).optional(),
  uygulanacakKur: z.union([z.string(), z.number()]).optional(),
  lastEdited: z.enum(['mahsup', 'kasa', 'kur'])
})

/**
 * POST /kurlar/capraz-hesap
 * Mahsup ↔ kasa ↔ kur — Decimal, açık yuvarlama.
 */
kurlarRouter.post('/capraz-hesap', requireAuth, async (req, res, next) => {
  try {
    const body = caprazHesapBody.parse(req.body)
    const result = resolveCaprazHesapFields(body)
    if ('error' in result) {
      res.status(400).json({ ok: false, error: result.error })
      return
    }
    res.json({ ok: true, ...result })
  } catch (e) {
    next(e)
  }
})
