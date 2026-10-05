import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { BackupConfigError, BackupTenantError } from '../backupErrors.js'

const bodySchema = z.object({
  calendarDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  confirmBuroAdi: z.string().trim().min(1).max(500)
})

function param(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return ''
}

function statusFor(code: string): number {
  if (code === 'RESTORE_TENANT_MISSING' || code === 'RESTORE_OBJECT_MISSING') return 404
  if (
    code === 'RESTORE_CONFIRMATION_MISMATCH' ||
    code === 'DATE_INVALID' ||
    code === 'TENANT_ID_INVALID' ||
    code === 'RESTORE_OBJECT_KEY'
  ) {
    return 400
  }
  return 409
}

function sendRestoreError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof BackupConfigError) {
    res.status(503).json({ ok: false, error: err.code })
    return
  }
  if (err instanceof BackupTenantError) {
    res.status(statusFor(err.code)).json({ ok: false, error: err.code })
    return
  }
  next(err)
}

export function createBackupRestoreRouter(deps: {
  requireAuth: RequestHandler
  requireSuper: RequestHandler
  loadDays: (tenantId: string) => Promise<unknown>
  restore: (input: { tenantId: string; calendarDate: string; confirmBuroAdi: string }) => Promise<unknown>
}): Router {
  const router = Router()
  router.get('/:tenantId', deps.requireAuth, deps.requireSuper, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await deps.loadDays(param(req.params.tenantId))
      res.json({ ok: true, ...(data as Record<string, unknown>) })
    } catch (err) {
      sendRestoreError(err, res, next)
    }
  })
  router.post(
    '/:tenantId/restore',
    deps.requireAuth,
    deps.requireSuper,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = bodySchema.parse(req.body)
        const data = await deps.restore({
          tenantId: param(req.params.tenantId),
          calendarDate: body.calendarDate,
          confirmBuroAdi: body.confirmBuroAdi
        })
        res.json({ ok: true, ...(data as Record<string, unknown>) })
      } catch (err) {
        sendRestoreError(err, res, next)
      }
    }
  )
  return router
}
