import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  createVekaletTaksitOdeme,
  getVekaletTaksitOdemeMakbuz,
  listVekaletTaksitOdemeler,
  markVekaletTaksitOdemeSmm
} from './vekaletTaksitOdeme.service.js'

export const vekaletTaksitOdemeleriRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })

const ODEME_ROLLER = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL] as const

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

vekaletTaksitOdemeleriRouter.post(
  '/:id/smm-kesildi',
  requireAuth,
  requireRole(...ODEME_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const odeme = await markVekaletTaksitOdemeSmm(tenantId, userId, id, req)
    res.json({ ok: true, odeme })
  })
)

vekaletTaksitOdemeleriRouter.get(
  '/:id/makbuz',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const makbuz = await getVekaletTaksitOdemeMakbuz(tenantId, id)
    if (!makbuz) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Ödeme kaydı bulunamadı.' })
      return
    }
    res.json({ ok: true, makbuz })
  })
)

export { listVekaletTaksitOdemeler, createVekaletTaksitOdeme }
