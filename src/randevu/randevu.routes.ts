import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  createRandevuBodySchema,
  listRandevuQuerySchema,
  updateRandevuBodySchema
} from './randevu.schemas.js'
import {
  createRandevu,
  deactivateRandevu,
  getRandevuById,
  listRandevular,
  serializeRandevu,
  updateRandevu
} from './randevu.service.js'

export const randevularRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

randevularRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const query = listRandevuQuerySchema.parse({
      baslangic: req.query.baslangic ?? req.query.start,
      bitis: req.query.bitis ?? req.query.end,
      muvekkilId: req.query.muvekkilId,
      sorumluUserId: req.query.sorumluUserId
    })
    const items = await listRandevular(tenantId, query)
    res.json({
      ok: true,
      items: items.map((r) => serializeRandevu(r)),
      total: items.length
    })
  })
)

randevularRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const row = await getRandevuById(tenantId, id)
    if (!row) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Randevu bulunamadı.' })
      return
    }
    res.json({ ok: true, randevu: serializeRandevu(row) })
  })
)

randevularRouter.post(
  '/',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL),
  asyncHandler(async (req, res) => {
    const body = createRandevuBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const created = await createRandevu(tenantId, userId, body, req)
    res.status(201).json({ ok: true, randevu: serializeRandevu(created) })
  })
)

randevularRouter.patch(
  '/:id',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = updateRandevuBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const updated = await updateRandevu(tenantId, id, body, req)
    res.json({ ok: true, randevu: serializeRandevu(updated) })
  })
)

randevularRouter.delete(
  '/:id',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    await deactivateRandevu(tenantId, id, req)
    res.status(204).send()
  })
)
