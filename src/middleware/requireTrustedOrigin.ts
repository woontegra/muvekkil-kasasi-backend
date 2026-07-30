import type { RequestHandler } from 'express'
import { getAllowedOrigins } from '../config/allowedOrigins.js'
import { env } from '../config/env.js'
import { AppError } from './errorHandler.js'

/**
 * Cookie kullanan durum değiştiren isteklerde kesin Origin doğrulaması.
 * Gevşek includes/suffix yok; yalnızca tam eşleşme.
 * CORS_ORIGIN + FRONTEND_URL + PUBLIC_APP_URL origin’leri kabul edilir.
 */
export const requireTrustedOrigin: RequestHandler = (req, _res, next) => {
  if (env.NODE_ENV === 'test') return next()

  const allowed = new Set(getAllowedOrigins())
  const origin = req.get('origin')?.trim()
  if (origin) {
    if (!allowed.has(origin)) {
      return next(new AppError(403, 'İstek kaynağı kabul edilmiyor.', 'ORIGIN_FORBIDDEN'))
    }
    return next()
  }

  // Aynı origin / non-browser: Referer host kontrolü
  const referer = req.get('referer')?.trim()
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin
      if (allowed.has(refOrigin)) return next()
    } catch {
      /* ignore */
    }
    return next(new AppError(403, 'İstek kaynağı kabul edilmiyor.', 'ORIGIN_FORBIDDEN'))
  }

  // Vercel rewrite proxy: Origin düşebilir; X-Forwarded-Host izinli frontend host ise kabul.
  const xfHost = req.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (xfHost && env.NODE_ENV === 'production') {
    for (const allowedOrigin of allowed) {
      try {
        if (new URL(allowedOrigin).host === xfHost) return next()
      } catch {
        /* ignore */
      }
    }
  }

  // Origin/Referer yoksa (curl vb.) production’da reddet; local’de izin.
  if (env.NODE_ENV === 'production') {
    return next(new AppError(403, 'İstek kaynağı doğrulanamadı.', 'ORIGIN_REQUIRED'))
  }
  return next()
}
