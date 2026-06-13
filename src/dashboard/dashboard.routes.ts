import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { getDashboardSummaryForTenant } from './dashboard.service.js'

export const dashboardRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

dashboardRouter.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const summary = await getDashboardSummaryForTenant(tenantId)
    res.json({ ok: true, ...summary })
  })
)
