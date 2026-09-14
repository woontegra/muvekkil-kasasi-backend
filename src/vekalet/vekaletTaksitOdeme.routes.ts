import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { updateVekaletTaksitOdemeBodySchema, guvenliSatirSilBodySchema } from './vekalet.schemas.js'
import {
  createVekaletTaksitOdeme,
  getVekaletTaksitOdemeMakbuz,
  listVekaletTaksitOdemeler,
  markVekaletTaksitOdemeSmm,
  updateVekaletTaksitOdeme
} from './vekaletTaksitOdeme.service.js'
import { guvenliIptalVekaletTahsilat } from './vekaletTahsilatIptal.service.js'
import { prisma } from '../lib/prisma.js'

export const vekaletTaksitOdemeleriRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })

const ODEME_ROLLER = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL] as const

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

vekaletTaksitOdemeleriRouter.put(
  '/:id',
  requireAuth,
  requireRole(...ODEME_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const body = updateVekaletTaksitOdemeBodySchema.parse(req.body)
    const odeme = await updateVekaletTaksitOdeme(tenantId, userId, id, body, req)
    res.json({ ok: true, odeme })
  })
)

vekaletTaksitOdemeleriRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.status(403).json({
      ok: false,
      error: 'FORBIDDEN',
      message: 'Tahsilat silme yalnızca büro sahibi güvenli iptal ile yapılabilir.'
    })
  })
)

vekaletTaksitOdemeleriRouter.post(
  '/:id/guvenli-sil',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const body = guvenliSatirSilBodySchema.parse(req.body)
    const actor = await prisma.user.findFirst({
      where: { id: userId, tenantId, aktifMi: true },
      select: { id: true, role: true, adSoyad: true, sifreHash: true }
    })
    if (!actor || actor.role !== UserRole.BURO_SAHIBI) {
      res.status(403).json({
        ok: false,
        error: 'FORBIDDEN',
        message: 'Bu işlem yalnızca büro sahibi tarafından yapılabilir.'
      })
      return
    }
    const result = await guvenliIptalVekaletTahsilat(tenantId, actor, id, body, req)
    res.json({
      ok: true,
      alreadyDone: result.alreadyDone,
      odemeId: result.odemeId,
      taksitId: result.taksitId,
      message: result.auditMessage
    })
  })
)

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
