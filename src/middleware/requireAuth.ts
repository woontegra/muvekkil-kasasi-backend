import type { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { TENANT_JWT_AUD, TENANT_JWT_ISS } from '../auth/jwt.js'
import { prisma } from '../lib/prisma.js'
import type { AuthUserPayload } from '../types/authPayload.js'
import { AppError } from './errorHandler.js'
import { assertTenantApiLicense } from '../tenant/tenantLicense.js'

/** Yeni tokenlar iss/aud ile; eski kısa ömürlü tokenlar süreleri dolana kadar kabul. */
function verifyTenantJwtRaw(token: string): Record<string, unknown> {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: TENANT_JWT_ISS,
      audience: TENANT_JWT_AUD
    }) as Record<string, unknown>
  } catch {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as Record<string, unknown>
  }
}

/** JWT doğrulama — büro oturumu; admin token kabul edilmez. Rol/aktiflik DB’den doğrulanır. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const h = req.header('authorization')?.trim()
  if (!h?.toLowerCase().startsWith('bearer ')) {
    return next(new AppError(401, 'Oturum gerekli', 'UNAUTHORIZED'))
  }
  const token = h.slice(7).trim()
  if (!token) {
    return next(new AppError(401, 'Oturum gerekli', 'UNAUTHORIZED'))
  }
  try {
    const raw = verifyTenantJwtRaw(token)
    if (raw.typ !== 'tenant') {
      return next(new AppError(401, 'Bu uç için büro oturumu gerekli.', 'WRONG_TOKEN_TYPE'))
    }
    const tenantId = typeof raw.tenantId === 'string' ? raw.tenantId : undefined
    const sub = typeof raw.sub === 'string' ? raw.sub : undefined
    if (!tenantId || !sub) {
      return next(new AppError(401, 'Geçersiz oturum', 'INVALID_TOKEN'))
    }

    const user = await prisma.user.findFirst({
      where: {
        id: sub,
        tenantId,
        aktifMi: true,
        tenant: { aktifMi: true }
      },
      select: {
        id: true,
        tenantId: true,
        role: true,
        kullaniciAdi: true
      }
    })
    if (!user) {
      return next(new AppError(401, 'Oturum geçersiz veya hesap pasif.', 'SESSION_INVALID'))
    }

    const payload: AuthUserPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      kullaniciAdi: user.kullaniciAdi,
      typ: 'tenant'
    }
    req.auth = payload
    req.tenantId = user.tenantId

    await assertTenantApiLicense(user.tenantId, req.method)
    next()
  } catch (e) {
    if (e instanceof AppError) {
      return next(e)
    }
    next(new AppError(401, 'Geçersiz veya süresi dolmuş oturum', 'INVALID_TOKEN'))
  }
}
