import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { loginBodySchema, registerOfficeBodySchema } from './auth.schemas.js'
import { login, registerOffice } from './auth.service.js'

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

authRouter.post('/logout', (_req, res) => {
  res.json({ ok: true, message: 'Oturum istemci tarafında sonlandırılmalıdır.' })
})
