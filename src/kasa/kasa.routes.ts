import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { createDuzeltmeBodySchema, rejectKasaBodySchema } from './kasa.schemas.js'
import {
  approveKasaHareketi,
  createDuzeltmeKasa,
  deleteKasaHareketi,
  rejectKasaHareketi,
  serializeKasaHareketi
} from './kasa.service.js'

export const kasaHareketleriRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })

const YONETICI_ROLLER = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI] as const

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

kasaHareketleriRouter.post(
  '/:id/onayla',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const updated = await approveKasaHareketi(tenantId, userId, id, req)
    res.json({ ok: true, kasaHareketi: serializeKasaHareketi({ ...updated, orijinalHareket: null }) })
  })
)

kasaHareketleriRouter.post(
  '/:id/reddet',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = rejectKasaBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const updated = await rejectKasaHareketi(tenantId, userId, id, body.redSebebi, req)
    res.json({ ok: true, kasaHareketi: serializeKasaHareketi({ ...updated, orijinalHareket: null }) })
  })
)

/** Düzeltme talebi: giriş yapmış her kullanıcı; onay yetkisi ayrı uçta. */
kasaHareketleriRouter.post(
  '/:id/duzeltme',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = createDuzeltmeBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const created = await createDuzeltmeKasa(tenantId, userId, id, body, req)
    const row = await prisma.kasaHareketi.findFirst({
      where: { id: created.id, tenantId },
      include: { orijinalHareket: { select: { id: true, belgeNo: true } } }
    })
    if (!row) {
      res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Kayıt okunamadı.' })
      return
    }
    res.status(201).json({ ok: true, kasaHareketi: serializeKasaHareketi(row) })
  })
)

kasaHareketleriRouter.delete(
  '/:id',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    await deleteKasaHareketi(tenantId, userId, id, req)
    res.status(204).send()
  })
)
