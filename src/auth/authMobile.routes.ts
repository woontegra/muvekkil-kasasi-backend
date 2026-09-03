import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { AppError } from '../middleware/errorHandler.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { loadAuthContext } from '../middleware/loadAuthContext.js'
import { authLoginRateLimit, authPasswordResetRateLimit, authRefreshRateLimit } from '../middleware/rateLimits.js'
import {
  activateLicenseBodySchema,
  changeInitialPasswordBodySchema,
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  resetPasswordBodySchema
} from './auth.schemas.js'
import { login, serializeTenant, serializeUser } from './auth.service.js'
import {
  activateLicenseForUser,
  changeInitialPasswordForUser,
  changePasswordForUser,
  getUserOnboardingFlags
} from './authOnboarding.service.js'
import { signAccessToken } from './jwt.js'
import { requestPasswordReset, resetPasswordWithToken } from './passwordReset.service.js'
import {
  createRefreshSession,
  revokeRefreshSessionByPlainToken,
  revokeUserRefreshSessions,
  rotateRefreshSession
} from './refreshSession.service.js'
import { revokeAdminRefreshSessions } from './adminRefreshSession.service.js'

export const authMobileRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

const MOBILE_REFRESH_TOKEN_HEADER = 'x-refresh-token'
const MOBILE_REFRESH_TOKEN_BODY_KEY = 'refreshToken'

function readMobileRefreshToken(req: Request): string | undefined {
  const header = req.get(MOBILE_REFRESH_TOKEN_HEADER)?.trim()
  if (header) return header
  const bodyValue = (req.body as Record<string, unknown> | undefined)?.[MOBILE_REFRESH_TOKEN_BODY_KEY]
  if (typeof bodyValue === 'string' && bodyValue.trim()) return bodyValue.trim()
  return undefined
}

authMobileRouter.post(
  '/login',
  authLoginRateLimit,
  asyncHandler(async (req, res) => {
    const body = loginBodySchema.parse(req.body)
    const payload = await login(body, req)
    const { plainToken } = await createRefreshSession({
      tenantId: payload.user.tenantId,
      userId: payload.user.id,
      label: 'mobile'
    })

    // Mobil istemci refresh token'ı cookie yerine body'de alır.
    res.json({ ok: true, ...payload, refreshToken: plainToken })
  })
)

authMobileRouter.post(
  '/refresh',
  authRefreshRateLimit,
  asyncHandler(async (req, res) => {
    const plain = readMobileRefreshToken(req)
    if (!plain) {
      throw new AppError(401, 'Oturum yenilenemedi. Lütfen tekrar giriş yapın.', 'REFRESH_MISSING')
    }
    const rotated = await rotateRefreshSession(plain)
    const { refreshPlain: refreshToken, ...payload } = rotated
    res.json({ ok: true, ...payload, refreshToken })
  })
)

authMobileRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const plain = readMobileRefreshToken(req)
    if (plain) {
      const tenantUserId = await revokeRefreshSessionByPlainToken(plain)
      if (tenantUserId) {
        const linked = await prisma.superAdmin.findFirst({
          where: { linkedUserId: tenantUserId },
          select: { id: true }
        })
        if (linked) await revokeAdminRefreshSessions(linked.id)
      }
    }
    res.json({ ok: true, message: 'Oturum sonlandırıldı.' })
  })
)

authMobileRouter.post(
  '/logout-all',
  requireAuth,
  loadAuthContext,
  asyncHandler(async (req, res) => {
    await revokeUserRefreshSessions(req.auth!.sub)
    const linked = await prisma.superAdmin.findFirst({
      where: { linkedUserId: req.auth!.sub },
      select: { id: true }
    })
    if (linked) await revokeAdminRefreshSessions(linked.id)
    res.json({ ok: true, message: 'Tüm cihazlardan çıkış yapıldı.' })
  })
)

authMobileRouter.post(
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

authMobileRouter.post(
  '/change-initial-password',
  requireAuth,
  loadAuthContext,
  asyncHandler(async (req, res) => {
    const body = changeInitialPasswordBodySchema.parse(req.body)
    await changeInitialPasswordForUser(req.user!, body, req)
    await revokeUserRefreshSessions(req.auth!.sub)
    const { loadUserWithTenant } = await import('./auth.service.js')
    const fresh = await loadUserWithTenant(req.auth!.sub, req.auth!.tenantId)
    if (!fresh) {
      res.status(401).json({ ok: false, message: 'Oturum geçersiz.', code: 'SESSION_INVALID' })
      return
    }
    const { plainToken } = await createRefreshSession({
      tenantId: fresh.tenantId,
      userId: fresh.id,
      label: 'mobile'
    })
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
      refreshToken: plainToken,
      user: serializeUser(fresh),
      tenant: serializeTenant(fresh.tenant),
      requiresLicenseActivation: flags.requiresLicenseActivation,
      mustChangePassword: flags.mustChangePassword
    })
  })
)

authMobileRouter.post(
  '/change-password',
  requireAuth,
  loadAuthContext,
  asyncHandler(async (req, res) => {
    const body = changePasswordBodySchema.parse(req.body)
    await changePasswordForUser(req.user!, body, req)
    await revokeUserRefreshSessions(req.auth!.sub)
    res.json({ ok: true, message: 'Şifreniz güncellendi. Lütfen tekrar giriş yapın.' })
  })
)

authMobileRouter.post(
  '/forgot-password',
  authPasswordResetRateLimit,
  asyncHandler(async (req, res) => {
    const body = forgotPasswordBodySchema.parse(req.body)
    const { message } = await requestPasswordReset(body, req)
    res.json({ ok: true, message })
  })
)

authMobileRouter.post(
  '/reset-password',
  authPasswordResetRateLimit,
  asyncHandler(async (req, res) => {
    const body = resetPasswordBodySchema.parse(req.body)
    const userId = await resetPasswordWithToken(body, req)
    if (userId) await revokeUserRefreshSessions(userId)
    res.json({ ok: true, message: 'Şifreniz güncellendi. Giriş yapabilirsiniz.' })
  })
)
