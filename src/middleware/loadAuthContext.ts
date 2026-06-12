import type { RequestHandler } from 'express'
import { loadUserWithTenant } from '../auth/auth.service.js'
import { AppError } from './errorHandler.js'

/** JWT sonrası veritabanından güncel kullanıcı + tenant yükler. */
export const loadAuthContext: RequestHandler = async (req, _res, next) => {
  if (!req.auth) {
    return next(new AppError(401, 'Oturum gerekli', 'UNAUTHORIZED'))
  }
  const row = await loadUserWithTenant(req.auth.sub, req.auth.tenantId)
  if (!row) {
    return next(new AppError(401, 'Oturum geçersiz veya hesap pasif.', 'SESSION_INVALID'))
  }
  req.user = row
  req.tenant = row.tenant
  next()
}
