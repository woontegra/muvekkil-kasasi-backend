import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  markTaksitPaidBodySchema,
  markTaksitSmmBodySchema,
  updateVekaletTaksitiBodySchema,
  createVekaletTaksitOdemeBodySchema
} from './vekalet.schemas.js'
import {
  cancelVekaletTaksiti,
  markVekaletTaksitPaid,
  markVekaletTaksitSmm,
  updateVekaletTaksiti
} from './vekalet.service.js'
import { createVekaletTaksitOdeme, listVekaletTaksitOdemeler } from './vekaletTaksitOdeme.service.js'

export const vekaletTaksitleriRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })

const YONETICI_ROLLER = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI] as const
const ODEME_ROLLER = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL] as const

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

vekaletTaksitleriRouter.post(
  '/:id/odemeler',
  requireAuth,
  requireRole(...ODEME_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const body = createVekaletTaksitOdemeBodySchema.parse(req.body)
    const taksit = await createVekaletTaksitOdeme(tenantId, userId, id, body, req)
    res.status(201).json({ ok: true, taksit })
  })
)

vekaletTaksitleriRouter.get(
  '/:id/odemeler',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const items = await listVekaletTaksitOdemeler(tenantId, id)
    if (items === null) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Taksit bulunamadı.' })
      return
    }
    res.json({ ok: true, items })
  })
)

vekaletTaksitleriRouter.put(
  '/:id',
  requireAuth,
  requireRole(...ODEME_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const role = req.auth!.role
    const body = updateVekaletTaksitiBodySchema.parse(req.body)
    const taksit = await updateVekaletTaksiti(tenantId, userId, role, id, body, req)
    res.json({ ok: true, taksit })
  })
)

vekaletTaksitleriRouter.post(
  '/:id/odendi',
  requireAuth,
  requireRole(...ODEME_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const body = markTaksitPaidBodySchema.parse(req.body)
    const taksit = await markVekaletTaksitPaid(tenantId, userId, id, body, req)
    res.json({ ok: true, taksit })
  })
)

vekaletTaksitleriRouter.post(
  '/:id/smm-kesildi',
  requireAuth,
  requireRole(...ODEME_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const body = markTaksitSmmBodySchema.parse(req.body)
    const taksit = await markVekaletTaksitSmm(tenantId, userId, id, body, req)
    res.json({ ok: true, taksit })
  })
)

vekaletTaksitleriRouter.delete(
  '/:id',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const role = req.auth!.role
    const taksit = await cancelVekaletTaksiti(tenantId, userId, role, id, req)
    res.json({ ok: true, taksit })
  })
)
