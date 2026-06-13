import type { RequestHandler } from 'express'
import { env } from '../config/env.js'
import { AppError } from './errorHandler.js'

/**
 * Kiracı bağlamı: öncelik JWT içindeki tenantId; geliştirme için isteğe bağlı X-Tenant-Id (sadece auth yokken / test).
 * Auth zorunlu rotalarda `requireAuth` önce çalışmalı; bu middleware tenantId'yi req.tenantId olarak set eder.
 */
export const tenantContext: RequestHandler = (req, _res, next) => {
  const fromJwt = req.auth?.tenantId
  if (fromJwt) {
    req.tenantId = fromJwt
    next()
    return
  }
  const header = req.header('x-tenant-id')?.trim()
  if (header) {
    if (env.NODE_ENV === 'production') {
      return next(new AppError(401, 'Kiracı bilgisi için oturum gerekli', 'TENANT_AUTH_REQUIRED'))
    }
    req.tenantId = header
    next()
    return
  }
  next()
}
