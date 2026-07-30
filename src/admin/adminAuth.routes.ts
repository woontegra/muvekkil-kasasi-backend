import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { adminLoginBodySchema } from './admin.schemas.js'
import { adminLogin } from './adminAuth.service.js'
import { adminLoginRateLimit, authRefreshRateLimit } from '../middleware/rateLimits.js'
import { requireTrustedOrigin } from '../middleware/requireTrustedOrigin.js'
import { requireAdminAuth } from '../middleware/requireAdminAuth.js'
import {
  createAdminRefreshSession,
  revokeAdminRefreshSessions,
  revokeCurrentAdminRefreshFromCookie,
  rotateAdminRefreshSession
} from '../auth/adminRefreshSession.service.js'
import {
  ADMIN_REFRESH_COOKIE,
  clearAdminRefreshCookie,
  setAdminRefreshCookie
} from '../auth/sessionCookies.js'
import { AppError } from '../middleware/errorHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { elevateAdminSessionFromTenantUser } from '../auth/linkedAdminSession.service.js'

export const adminAuthRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

adminAuthRouter.post(
  '/login',
  adminLoginRateLimit,
  asyncHandler(async (req, res) => {
    const body = adminLoginBodySchema.parse(req.body)
    const out = await adminLogin(body, req)
    const { plainToken } = await createAdminRefreshSession({
      adminId: out.adminUser.id,
      label: 'admin-web'
    })
    setAdminRefreshCookie(res, plainToken)
    res.json({ ok: true, adminAccessToken: out.adminAccessToken, adminUser: out.adminUser })
  })
)

adminAuthRouter.post(
  '/refresh',
  authRefreshRateLimit,
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    const plain = req.cookies?.[ADMIN_REFRESH_COOKIE]
    if (typeof plain !== 'string' || !plain) {
      clearAdminRefreshCookie(res)
      throw new AppError(401, 'Admin oturumu yenilenemedi.', 'ADMIN_REFRESH_MISSING')
    }
    const rotated = await rotateAdminRefreshSession(plain)
    setAdminRefreshCookie(res, rotated.refreshPlain)
    res.json({
      ok: true,
      adminAccessToken: rotated.adminAccessToken,
      adminUser: rotated.adminUser
    })
  })
)

adminAuthRouter.post(
  '/elevate-from-tenant',
  requireAuth,
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    const out = await elevateAdminSessionFromTenantUser(req.auth!.sub, req)
    if (!out) {
      throw new AppError(403, 'Bu hesap için platform admin yetkisi yok.', 'ADMIN_ELEVATE_DENIED')
    }
    setAdminRefreshCookie(res, out.refreshPlain)
    res.json({
      ok: true,
      adminAccessToken: out.adminAccessToken,
      adminUser: out.adminUser
    })
  })
)

adminAuthRouter.post(
  '/logout',
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    await revokeCurrentAdminRefreshFromCookie(req)
    clearAdminRefreshCookie(res)
    res.json({ ok: true })
  })
)

adminAuthRouter.post(
  '/logout-all',
  requireAdminAuth,
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    await revokeAdminRefreshSessions(req.adminAuth!.sub)
    clearAdminRefreshCookie(res)
    res.json({ ok: true, message: 'Tüm admin oturumları sonlandırıldı.' })
  })
)
