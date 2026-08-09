import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import {
  activateLicenseBodySchema,
  changeInitialPasswordBodySchema,
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  resetPasswordBodySchema
} from './auth.schemas.js'
import { login, serializeTenant, serializeUser } from './auth.service.js'
import { activateLicenseForUser, changeInitialPasswordForUser, changePasswordForUser, getUserOnboardingFlags } from './authOnboarding.service.js'
import { requestPasswordReset, resetPasswordWithToken } from './passwordReset.service.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { loadAuthContext } from '../middleware/loadAuthContext.js'
import {
  authLoginRateLimit,
  authPasswordResetRateLimit,
  authRefreshRateLimit
} from '../middleware/rateLimits.js'
import { requireTrustedOrigin } from '../middleware/requireTrustedOrigin.js'
import {
  createRefreshSession,
  revokeCurrentRefreshFromCookie,
  revokeUserRefreshSessions,
  rotateRefreshSession
} from './refreshSession.service.js'
import {
  clearAdminRefreshCookie,
  clearTenantRefreshCookie,
  setAdminRefreshCookie,
  setTenantRefreshCookie,
  TENANT_REFRESH_COOKIE
} from './sessionCookies.js'
import { AppError } from '../middleware/errorHandler.js'
import { tryCreateLinkedAdminSession } from './linkedAdminSession.service.js'
import { revokeAdminRefreshSessions } from './adminRefreshSession.service.js'
import { prisma } from '../lib/prisma.js'

export const authRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

/** Public self-service büro oluşturma kapalı; yalnız admin `POST /api/v1/admin/tenants`. */
authRouter.post('/register-office', (_req, res) => {
  res.status(403).json({
    ok: false,
    message: 'Büro hesabı oluşturma işlemi Woontegra tarafından yapılır.',
    code: 'PUBLIC_REGISTRATION_DISABLED'
  })
})

authRouter.post(
  '/login',
  authLoginRateLimit,
  asyncHandler(async (req, res) => {
    const body = loginBodySchema.parse(req.body)
    const payload = await login(body, req)
    const { plainToken } = await createRefreshSession({
      tenantId: payload.user.tenantId,
      userId: payload.user.id,
      label: 'web'
    })
    setTenantRefreshCookie(res, plainToken)

    const linkedAdmin = await tryCreateLinkedAdminSession(payload.user.id, req)
    if (linkedAdmin) {
      setAdminRefreshCookie(res, linkedAdmin.refreshPlain)
      res.json({
        ok: true,
        ...payload,
        adminAccessToken: linkedAdmin.adminAccessToken,
        adminUser: linkedAdmin.adminUser
      })
      return
    }

    res.json({ ok: true, ...payload })
  })
)

authRouter.post(
  '/refresh',
  authRefreshRateLimit,
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    const plain = req.cookies?.[TENANT_REFRESH_COOKIE]
    if (typeof plain !== 'string' || !plain) {
      clearTenantRefreshCookie(res)
      throw new AppError(401, 'Oturum yenilenemedi. Lütfen tekrar giriş yapın.', 'REFRESH_MISSING')
    }
    const rotated = await rotateRefreshSession(plain)
    setTenantRefreshCookie(res, rotated.refreshPlain)
    const { refreshPlain: _, ...payload } = rotated
    res.json({ ok: true, ...payload })
  })
)

authRouter.post(
  '/logout',
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    const tenantUserId = await revokeCurrentRefreshFromCookie(req)
    if (tenantUserId) {
      const linked = await prisma.superAdmin.findFirst({
        where: { linkedUserId: tenantUserId },
        select: { id: true }
      })
      if (linked) await revokeAdminRefreshSessions(linked.id)
    } else {
      const { revokeCurrentAdminRefreshFromCookie } = await import('./adminRefreshSession.service.js')
      await revokeCurrentAdminRefreshFromCookie(req).catch(() => undefined)
    }
    clearTenantRefreshCookie(res)
    clearAdminRefreshCookie(res)
    res.json({ ok: true, message: 'Oturum sonlandırıldı.' })
  })
)

authRouter.post(
  '/logout-all',
  requireAuth,
  loadAuthContext,
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    await revokeUserRefreshSessions(req.auth!.sub)
    const linked = await prisma.superAdmin.findFirst({
      where: { linkedUserId: req.auth!.sub },
      select: { id: true }
    })
    if (linked) await revokeAdminRefreshSessions(linked.id)
    clearTenantRefreshCookie(res)
    clearAdminRefreshCookie(res)
    res.json({ ok: true, message: 'Tüm cihazlardan çıkış yapıldı.' })
  })
)

authRouter.post(
  '/activate-license',
  requireAuth,
  loadAuthContext,
  asyncHandler(async (req, res) => {
    const body = activateLicenseBodySchema.parse(req.body)
    await activateLicenseForUser(req.user!, body, req)
    const { loadUserWithTenant } = await import('./auth.service.js')
    const fresh = await loadUserWithTenant(req.auth!.sub, req.auth!.tenantId)
    if (!fresh) {
      res.status(401).json({ ok: false, message: 'Oturum geçersiz.', code: 'SESSION_INVALID' })
      return
    }
    const flags = getUserOnboardingFlags(fresh, fresh.tenant)
    res.json({
      ok: true,
      user: serializeUser(fresh),
      tenant: serializeTenant(fresh.tenant),
      requiresLicenseActivation: flags.requiresLicenseActivation,
      mustChangePassword: flags.mustChangePassword
    })
  })
)

authRouter.post(
  '/change-initial-password',
  requireAuth,
  loadAuthContext,
  asyncHandler(async (req, res) => {
    const body = changeInitialPasswordBodySchema.parse(req.body)
    await changeInitialPasswordForUser(req.user!, body, req)
    await revokeUserRefreshSessions(req.auth!.sub)
    clearTenantRefreshCookie(res)
    const { loadUserWithTenant } = await import('./auth.service.js')
    const fresh = await loadUserWithTenant(req.auth!.sub, req.auth!.tenantId)
    if (!fresh) {
      res.status(401).json({ ok: false, message: 'Oturum geçersiz.', code: 'SESSION_INVALID' })
      return
    }
    // Parola değişince yeni refresh oturumu + kısa access
    const { createRefreshSession: createRt } = await import('./refreshSession.service.js')
    const { signAccessToken } = await import('./jwt.js')
    const { plainToken } = await createRt({
      tenantId: fresh.tenantId,
      userId: fresh.id,
      label: 'web'
    })
    setTenantRefreshCookie(res, plainToken)
    const accessToken = signAccessToken({
      userId: fresh.id,
      tenantId: fresh.tenantId,
      role: fresh.role,
      kullaniciAdi: fresh.kullaniciAdi
    })
    const flags = getUserOnboardingFlags(fresh, fresh.tenant)
    res.json({
      ok: true,
      message: 'Şifreniz güncellendi.',
      accessToken,
      user: serializeUser(fresh),
      tenant: serializeTenant(fresh.tenant),
      requiresLicenseActivation: flags.requiresLicenseActivation,
      mustChangePassword: flags.mustChangePassword
    })
  })
)

authRouter.post(
  '/change-password',
  requireAuth,
  loadAuthContext,
  asyncHandler(async (req, res) => {
    const body = changePasswordBodySchema.parse(req.body)
    await changePasswordForUser(req.user!, body, req)
    await revokeUserRefreshSessions(req.auth!.sub)
    clearTenantRefreshCookie(res)
    res.json({ ok: true, message: 'Şifreniz güncellendi. Lütfen tekrar giriş yapın.' })
  })
)

authRouter.post(
  '/forgot-password',
  authPasswordResetRateLimit,
  asyncHandler(async (req, res) => {
    const body = forgotPasswordBodySchema.parse(req.body)
    const { message } = await requestPasswordReset(body, req)
    res.json({ ok: true, message })
  })
)

authRouter.post(
  '/reset-password',
  authPasswordResetRateLimit,
  asyncHandler(async (req, res) => {
    const body = resetPasswordBodySchema.parse(req.body)
    const userId = await resetPasswordWithToken(body, req)
    if (userId) await revokeUserRefreshSessions(userId)
    clearTenantRefreshCookie(res)
    res.json({ ok: true, message: 'Şifreniz güncellendi. Giriş yapabilirsiniz.' })
  })
)
