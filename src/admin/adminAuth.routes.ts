import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { adminLoginBodySchema } from './admin.schemas.js'
import { adminLogin } from './adminAuth.service.js'

export const adminAuthRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

adminAuthRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = adminLoginBodySchema.parse(req.body)
    const out = await adminLogin(body, req)
    res.json({ ok: true, adminAccessToken: out.adminAccessToken, adminUser: out.adminUser })
  })
)

adminAuthRouter.post('/logout', (_req, res) => {
  res.json({ ok: true })
})
