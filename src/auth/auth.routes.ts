import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { forgotPasswordBodySchema, loginBodySchema, resetPasswordBodySchema } from './auth.schemas.js'
import { login } from './auth.service.js'
import { requestPasswordReset, resetPasswordWithToken } from './passwordReset.service.js'

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
    const { accessToken, user, tenant } = await login(body, req)
    res.json({ ok: true, accessToken, user, tenant })
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
