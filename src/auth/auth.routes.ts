import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { forgotPasswordBodySchema, loginBodySchema, registerOfficeBodySchema, resetPasswordBodySchema } from './auth.schemas.js'
import { login, registerOffice } from './auth.service.js'
import { requestPasswordReset, resetPasswordWithToken } from './passwordReset.service.js'

export const authRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

authRouter.post(
  '/register-office',
  asyncHandler(async (req, res) => {
    const body = registerOfficeBodySchema.parse(req.body)
    const { accessToken, user, tenant } = await registerOffice(body, req)
    res.status(201).json({ ok: true, accessToken, user, tenant })
  })
)

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
