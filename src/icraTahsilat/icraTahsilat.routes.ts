import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  createIcraTahsilatAlacagi,
  createIcraTaksitOdeme,
  deleteIcraTahsilatTaksit,
  getIcraTahsilatById,
  listIcraTahsilat,
  listIcraTaksitOdemeler,
  markIcraTahsilatOdemeSmm,
  patchIcraTahsilatAlacagi,
  patchIcraTahsilatTaksit
} from './icraTahsilat.service.js'
import {
  createIcraTahsilatBodySchema,
  createIcraTaksitOdemeBodySchema,
  listIcraTahsilatQuerySchema,
  patchIcraTahsilatBodySchema,
  patchIcraTaksitBodySchema
} from './icraTahsilat.schemas.js'

export const icraTahsilatRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })
const taksitIdParamSchema = z.object({ taksitId: z.string().uuid('Geçersiz taksit id.') })
const odemeIdParamSchema = z.object({ odemeId: z.string().uuid('Geçersiz ödeme id.') })

const YAZMA_ROLLER = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL] as const
const YONETICI_ROLLER = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI] as const

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

icraTahsilatRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = listIcraTahsilatQuerySchema.parse(req.query)
    const tenantId = req.auth!.tenantId
    const result = await listIcraTahsilat(tenantId, query)
    res.json({ ok: true, ...result })
  })
)

icraTahsilatRouter.post(
  '/',
  requireAuth,
  requireRole(...YAZMA_ROLLER),
  asyncHandler(async (req, res) => {
    const body = createIcraTahsilatBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const row = await createIcraTahsilatAlacagi(tenantId, userId, req.auth!.role, body, req)
    res.status(201).json({ ok: true, alacak: row })
  })
)

icraTahsilatRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const alacak = await getIcraTahsilatById(tenantId, id)
    res.json({ ok: true, alacak })
  })
)

icraTahsilatRouter.patch(
  '/:id',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = patchIcraTahsilatBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const alacak = await patchIcraTahsilatAlacagi(tenantId, userId, id, body, req)
    res.json({ ok: true, alacak })
  })
)

icraTahsilatRouter.patch(
  '/taksit/:taksitId',
  requireAuth,
  requireRole(...YAZMA_ROLLER),
  asyncHandler(async (req, res) => {
    const { taksitId } = taksitIdParamSchema.parse(req.params)
    const body = patchIcraTaksitBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const alacak = await patchIcraTahsilatTaksit(tenantId, userId, taksitId, body, req)
    res.json({ ok: true, alacak })
  })
)

icraTahsilatRouter.delete(
  '/taksit/:taksitId',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { taksitId } = taksitIdParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const alacak = await deleteIcraTahsilatTaksit(tenantId, userId, taksitId, req)
    res.json({ ok: true, alacak })
  })
)

icraTahsilatRouter.post(
  '/:id/taksit/:taksitId/odeme',
  requireAuth,
  requireRole(...YAZMA_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const { taksitId } = taksitIdParamSchema.parse(req.params)
    const body = createIcraTaksitOdemeBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const alacak = await createIcraTaksitOdeme(tenantId, userId, req.auth!.role, id, taksitId, body, req)
    res.status(201).json({ ok: true, alacak })
  })
)

icraTahsilatRouter.get(
  '/:id/taksit/:taksitId/odemeler',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const { taksitId } = taksitIdParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const items = await listIcraTaksitOdemeler(tenantId, id, taksitId)
    res.json({ ok: true, items })
  })
)

icraTahsilatRouter.patch(
  '/odeme/:odemeId/smm-kesildi',
  requireAuth,
  requireRole(...YAZMA_ROLLER),
  asyncHandler(async (req, res) => {
    const { odemeId } = odemeIdParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const odeme = await markIcraTahsilatOdemeSmm(tenantId, userId, odemeId, req)
    res.json({ ok: true, odeme })
  })
)
