import type { RequestHandler } from 'express'
import type { UserRole } from '@prisma/client'
import { AppError } from './errorHandler.js'

/** JWT içindeki role göre erişim (ileride ince izinlerle birleştirilebilir). */
export function requireRole(...allowed: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    const role = req.auth?.role
    if (!role) {
      return next(new AppError(401, 'Oturum gerekli', 'UNAUTHORIZED'))
    }
    if (!allowed.includes(role)) {
      return next(new AppError(403, 'Bu işlem için yetkiniz yok.', 'FORBIDDEN'))
    }
    next()
  }
}
