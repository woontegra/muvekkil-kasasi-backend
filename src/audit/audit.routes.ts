import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { loadAuthContext } from '../middleware/loadAuthContext.js'
import { requirePermission } from '../middleware/requirePermission.js'
import { Permission } from '../permissions/roles.js'
import { listAuditLogsForTenant } from './audit.service.js'

export const auditRouter = Router()

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30)
})

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

auditRouter.get(
  '/',
  requireAuth,
  loadAuthContext,
  requirePermission(Permission.AUDIT_READ),
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query)
    const data = await listAuditLogsForTenant(req.auth!.tenantId, q.page, q.limit)
    res.json({ ok: true, ...data })
  })
)
