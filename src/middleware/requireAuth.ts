import type { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import type { AuthUserPayload } from '../types/authPayload.js'
import { AppError } from './errorHandler.js'
import { assertTenantApiLicense } from '../tenant/tenantLicense.js'

/** JWT doğrulama — büro oturumu; admin token kabul edilmez. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const h = req.header('authorization')?.trim()
  if (!h?.toLowerCase().startsWith('bearer ')) {
    return next(new AppError(401, 'Oturum gerekli', 'UNAUTHORIZED'))
  }
  const token = h.slice(7).trim()
  if (!token) {
    return next(new AppError(401, 'Oturum gerekli', 'UNAUTHORIZED'))
  }
  try {
    const raw = jwt.verify(token, env.JWT_SECRET) as Record<string, unknown>
    if (raw.typ === 'admin') {
      return next(new AppError(401, 'Bu uç için büro oturumu gerekli.', 'WRONG_TOKEN_TYPE'))
    }
    const tenantId = raw.tenantId as string | undefined
    const sub = raw.sub as string | undefined
    const role = raw.role as AuthUserPayload['role'] | undefined
    const kullaniciAdi = raw.kullaniciAdi as string | undefined
    if (!tenantId || !sub || !role || !kullaniciAdi) {
      return next(new AppError(401, 'Geçersiz oturum', 'INVALID_TOKEN'))
    }
    const payload: AuthUserPayload = { sub, tenantId, role, kullaniciAdi }
    req.auth = payload
    req.tenantId = tenantId

    await assertTenantApiLicense(tenantId, req.method)
    next()
  } catch (e) {
    if (e instanceof AppError) {
      return next(e)
    }
    next(new AppError(401, 'Geçersiz veya süresi dolmuş oturum', 'INVALID_TOKEN'))
  }
}
