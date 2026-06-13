import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { loadAuthContext } from '../middleware/loadAuthContext.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { buildTenantLicenseCurrent } from './license.service.js'

export const licenseRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

licenseRouter.get(
  '/current',
  requireAuth,
  loadAuthContext,
  asyncHandler(async (req, res) => {
    const tenant = req.tenant!
    const payload = buildTenantLicenseCurrent(tenant, req.auth!.role)
    res.json({ ok: true, ...payload })
  })
)
