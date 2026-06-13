import type { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import type { AuthUserPayload } from '../types/authPayload.js'
import { AppError } from './errorHandler.js'

/** JWT doğrulama — `authenticateJwt` ile aynı. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const h = req.header('authorization')?.trim()
  if (!h?.toLowerCase().startsWith('bearer ')) {
    return next(new AppError(401, 'Oturum gerekli', 'UNAUTHORIZED'))
  }
  const token = h.slice(7).trim()
  if (!token) {
    return next(new AppError(401, 'Oturum gerekli', 'UNAUTHORIZED'))
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthUserPayload
    req.auth = payload
    req.tenantId = payload.tenantId
    next()
  } catch {
    next(new AppError(401, 'Geçersiz veya süresi dolmuş oturum', 'INVALID_TOKEN'))
  }
}
