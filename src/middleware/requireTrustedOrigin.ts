import type { RequestHandler } from 'express'
import { env } from '../config/env.js'
import { AppError } from './errorHandler.js'

function parseAllowedOrigins(): Set<string> {
  const raw = env.CORS_ORIGIN
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

/**
 * Cookie kullanan durum değiştiren isteklerde kesin Origin doğrulaması.
 * Gevşek includes/suffix yok; yalnızca tam eşleşme.
 */
export const requireTrustedOrigin: RequestHandler = (req, _res, next) => {
  if (env.NODE_ENV === 'test') return next()

  const allowed = parseAllowedOrigins()
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

  // Origin/Referer yoksa (curl vb.) production’da reddet; local’de izin.
  if (env.NODE_ENV === 'production') {
    return next(new AppError(403, 'İstek kaynağı doğrulanamadı.', 'ORIGIN_REQUIRED'))
  }
  return next()
}
