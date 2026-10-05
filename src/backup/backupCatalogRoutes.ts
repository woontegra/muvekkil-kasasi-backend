import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import type { BackupCatalogQuery } from './backupCatalog.js'
import { BackupConfigError } from './backupErrors.js'

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20)
})

function firstQuery(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

export function createBackupCatalogRouter(deps: {
  requireAuth: RequestHandler
  requireSuper: RequestHandler
  load: (query: BackupCatalogQuery) => Promise<unknown>
}): Router {
  const router = Router()
  router.get('/', deps.requireAuth, deps.requireSuper, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = querySchema.parse({
        q: firstQuery(req.query.q),
        page: firstQuery(req.query.page),
        limit: firstQuery(req.query.limit)
      })
      const data = await deps.load({
        q: parsed.q,
        page: parsed.page,
        limit: parsed.limit
      })
      res.json({ ok: true, ...(data as Record<string, unknown>) })
    } catch (err) {
      if (err instanceof BackupConfigError) {
        res.status(503).json({ ok: false, error: err.code })
        return
      }
      next(err)
    }
  })
  return router
}
