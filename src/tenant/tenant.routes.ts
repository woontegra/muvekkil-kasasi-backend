import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { serializeTenant } from '../auth/auth.service.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { loadAuthContext } from '../middleware/loadAuthContext.js'
import { requireRole } from '../middleware/requireRole.js'
import { tenantProfileUpdateBodySchema } from './tenant.schemas.js'
import { updateTenantProfile } from './tenant.service.js'

export const tenantRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

tenantRouter.patch(
  '/profile',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI),
  asyncHandler(async (req, res) => {
    const body = tenantProfileUpdateBodySchema.parse(req.body)
    const updated = await updateTenantProfile(req.auth!.tenantId, req.auth!.sub, body, req)
    res.json({ ok: true, tenant: serializeTenant(updated) })
  })
)
