import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  createOfisKasaDuzeltmeBodySchema,
  createOfisKasaHareketiBodySchema,
  listOfisKasaHareketleriQuerySchema,
  rejectOfisKasaBodySchema
} from './ofisKasa.schemas.js'
import {
  approveOfisKasaHareketi,
  createOfisKasaDuzeltme,
  createOfisKasaHareketi,
  deleteOfisKasaHareketi,
  getOfisKasaOzet,
  listOfisKasaHareketleri,
  rejectOfisKasaHareketi,
  serializeOfisKasaHareketi
} from './ofisKasa.service.js'

export const ofisKasasiRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })

const YONETICI_ROLLER = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI] as const
const HAREKET_OLUSTURMA_ROLLER = [
  UserRole.BURO_SAHIBI,
  UserRole.AVUKAT_YONETICI,
  UserRole.KATIP_PERSONEL
] as const

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

ofisKasasiRouter.get(
  '/ozet',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const ozet = await getOfisKasaOzet(tenantId)
    res.json({ ok: true, ozet })
  })
)

ofisKasasiRouter.get(
  '/hareketler',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const query = listOfisKasaHareketleriQuerySchema.parse(req.query)
    const { items, total } = await listOfisKasaHareketleri(tenantId, query)
    res.json({
      ok: true,
      items: items.map((h) => serializeOfisKasaHareketi(h)),
      total,
      page: query.page,
      limit: query.limit
    })
  })
)

ofisKasasiRouter.post(
  '/hareketler',
  requireAuth,
  requireRole(...HAREKET_OLUSTURMA_ROLLER),
  asyncHandler(async (req, res) => {
    const body = createOfisKasaHareketiBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const created = await createOfisKasaHareketi(tenantId, userId, body, req)
    const row = await prisma.ofisKasaHareketi.findFirst({
      where: { id: created.id, tenantId },
      include: { orijinalHareket: { select: { id: true, belgeNo: true } } }
    })
    if (!row) {
      res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Kayıt okunamadı.' })
      return
    }
    res.status(201).json({ ok: true, ofisKasaHareketi: serializeOfisKasaHareketi(row) })
  })
)

ofisKasasiRouter.post(
  '/hareketler/:id/onayla',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const updated = await approveOfisKasaHareketi(tenantId, userId, id, req)
    res.json({ ok: true, ofisKasaHareketi: serializeOfisKasaHareketi({ ...updated, orijinalHareket: null }) })
  })
)

ofisKasasiRouter.post(
  '/hareketler/:id/reddet',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = rejectOfisKasaBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const updated = await rejectOfisKasaHareketi(tenantId, userId, id, body.redSebebi, req)
    res.json({ ok: true, ofisKasaHareketi: serializeOfisKasaHareketi({ ...updated, orijinalHareket: null }) })
  })
)

ofisKasasiRouter.post(
  '/hareketler/:id/duzeltme',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = createOfisKasaDuzeltmeBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const created = await createOfisKasaDuzeltme(tenantId, userId, id, body, req)
    const row = await prisma.ofisKasaHareketi.findFirst({
      where: { id: created.id, tenantId },
      include: { orijinalHareket: { select: { id: true, belgeNo: true } } }
    })
    if (!row) {
      res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Kayıt okunamadı.' })
      return
    }
    res.status(201).json({ ok: true, ofisKasaHareketi: serializeOfisKasaHareketi(row) })
  })
)

ofisKasasiRouter.delete(
  '/hareketler/:id',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    await deleteOfisKasaHareketi(tenantId, userId, id, req)
    res.status(204).send()
  })
)
