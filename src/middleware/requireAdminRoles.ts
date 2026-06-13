import type { SuperAdminRole } from '@prisma/client'
import type { RequestHandler } from 'express'
import { AppError } from './errorHandler.js'

/** En az bir rol eşleşmeli. */
export function requireAdminRoles(...allowed: SuperAdminRole[]): RequestHandler {
  return (req, _res, next) => {
    const role = req.adminAuth?.role
    if (!role) {
      return next(new AppError(401, 'Admin oturumu gerekli', 'ADMIN_UNAUTHORIZED'))
    }
    if (!allowed.includes(role)) {
      return next(new AppError(403, 'Bu işlem için yetkiniz yok.', 'ADMIN_FORBIDDEN'))
    }
    next()
  }
}
