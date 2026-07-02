import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import {
  activateLicenseBodySchema,
  changeInitialPasswordBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  resetPasswordBodySchema
} from './auth.schemas.js'
import { login, serializeTenant, serializeUser } from './auth.service.js'
import { activateLicenseForUser, changeInitialPasswordForUser, getUserOnboardingFlags } from './authOnboarding.service.js'
import { requestPasswordReset, resetPasswordWithToken } from './passwordReset.service.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { loadAuthContext } from '../middleware/loadAuthContext.js'

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
  asyncHandler(async (req, res) => {
    const body = loginBodySchema.parse(req.body)
    const payload = await login(body, req)
    res.json({ ok: true, ...payload })
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
    const { loadUserWithTenant } = await import('./auth.service.js')
    const fresh = await loadUserWithTenant(req.auth!.sub, req.auth!.tenantId)
    if (!fresh) {
      res.status(401).json({ ok: false, message: 'Oturum geçersiz.', code: 'SESSION_INVALID' })
      return
    }
    const flags = getUserOnboardingFlags(fresh, fresh.tenant)
    res.json({
      ok: true,
      message: 'Şifreniz güncellendi.',
      user: serializeUser(fresh),
      tenant: serializeTenant(fresh.tenant),
      requiresLicenseActivation: flags.requiresLicenseActivation,
      mustChangePassword: flags.mustChangePassword
    })
  })
)

authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const body = forgotPasswordBodySchema.parse(req.body)
    const { message } = await requestPasswordReset(body, req)
    res.json({ ok: true, message })
  })
)

authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const body = resetPasswordBodySchema.parse(req.body)
    await resetPasswordWithToken(body, req)
    res.json({ ok: true, message: 'Şifreniz güncellendi. Giriş yapabilirsiniz.' })
  })
)

authRouter.post('/logout', (_req, res) => {
  res.json({ ok: true, message: 'Oturum istemci tarafında sonlandırılmalıdır.' })
})
