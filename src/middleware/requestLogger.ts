import type { RequestHandler } from 'express'

/**
 * Basit istek günlüğü — üretimde merkezi log sistemine taşınabilir.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - start
    const tenant = req.tenantId ?? req.auth?.tenantId ?? '-'
    // eslint-disable-next-line no-console
    console.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms tenant=${tenant}`)
  })
  next()
}
