import type { RequestHandler } from 'express'
import { AppError } from './errorHandler.js'
import type { PermissionKey } from '../permissions/roles.js'
import { roleHasPermission } from '../permissions/roles.js'

export function requirePermission(key: PermissionKey): RequestHandler {
  return (req, _res, next) => {
    const role = req.auth?.role
    if (!role) {
      return next(new AppError(401, 'Oturum gerekli', 'UNAUTHORIZED'))
    }
    if (!roleHasPermission(role, key)) {
      return next(new AppError(403, 'Bu işlem için yetkiniz yok', 'FORBIDDEN'))
    }
    next()
  }
}
