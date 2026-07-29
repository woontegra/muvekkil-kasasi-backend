import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { getMaliKontrolUyarilari } from './maliKontrol.service.js'

export const maliKontrolRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

maliKontrolRouter.get(
  '/uyarilar',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const data = await getMaliKontrolUyarilari(tenantId)
    res.json({ ok: true, ...data })
  })
)
