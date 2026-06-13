import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { listSmmBekleyenlerForTenant } from './smm.service.js'

export const smmRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

smmRouter.get(
  '/bekleyenler',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const items = await listSmmBekleyenlerForTenant(tenantId)
    res.json({ ok: true, items, total: items.length })
  })
)
