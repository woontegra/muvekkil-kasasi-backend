import type { RequestHandler } from 'express'
import { verifyAdminAccessToken } from '../auth/adminJwt.js'
import { AppError } from './errorHandler.js'

export const requireAdminAuth: RequestHandler = (req, _res, next) => {
  const h = req.header('authorization')?.trim()
  if (!h?.toLowerCase().startsWith('bearer ')) {
    return next(new AppError(401, 'Admin oturumu gerekli', 'ADMIN_UNAUTHORIZED'))
  }
  const token = h.slice(7).trim()
  if (!token) {
    return next(new AppError(401, 'Admin oturumu gerekli', 'ADMIN_UNAUTHORIZED'))
  }
  try {
    const payload = verifyAdminAccessToken(token)
    req.adminAuth = payload
    next()
  } catch {
    next(new AppError(401, 'Geçersiz veya süresi dolmuş admin oturumu', 'ADMIN_INVALID_TOKEN'))
  }
}
