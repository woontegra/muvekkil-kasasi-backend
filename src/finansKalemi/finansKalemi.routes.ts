import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { loadAuthContext } from '../middleware/loadAuthContext.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  createFinansKalemiBodySchema,
  listFinansKalemleriQuerySchema,
  reorderFinansKalemleriBodySchema,
  updateFinansKalemiBodySchema
} from './finansKalemi.schemas.js'
import {
  activateFinansKalemi,
  archiveFinansKalemi,
  createFinansKalemi,
  listFinansKalemleri,
  reorderFinansKalemleri,
  updateFinansKalemi
} from './finansKalemi.service.js'

export const finansKalemleriRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

/** Aktif (veya filtreli) kalem listesi — tüm tenant rolleri (form seçenekleri). */
finansKalemleriRouter.get(
  '/',
  requireAuth,
  loadAuthContext,
  asyncHandler(async (req, res) => {
    const query = listFinansKalemleriQuerySchema.parse({
      tur: req.query.tur,
      aktif: req.query.aktif,
      includeSistem: req.query.includeSistem
    })
    // Yönetim görünümü (pasif + sistem) yalnız büro sahibi.
    if ((query.aktif !== 'true' || query.includeSistem) && req.auth!.role !== UserRole.BURO_SAHIBI) {
      res.status(403).json({
        ok: false,
        error: 'FORBIDDEN',
        message: 'Kalem yönetimi yalnız büro sahibi tarafından yapılabilir.'
      })
      return
    }
    const items = await listFinansKalemleri(req.auth!.tenantId, query)
    res.json({ ok: true, items })
  })
)

finansKalemleriRouter.post(
  '/',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI),
  asyncHandler(async (req, res) => {
    const body = createFinansKalemiBodySchema.parse(req.body)
    const result = await createFinansKalemi(req.auth!.tenantId, req.auth!.sub, body)
    res.status(201).json({ ok: true, item: result.item, reactivated: result.reactivated })
  })
)

finansKalemleriRouter.post(
  '/reorder',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI),
  asyncHandler(async (req, res) => {
    const body = reorderFinansKalemleriBodySchema.parse(req.body)
    const items = await reorderFinansKalemleri(req.auth!.tenantId, req.auth!.sub, body)
    res.json({ ok: true, items })
  })
)

finansKalemleriRouter.patch(
  '/:id',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = updateFinansKalemiBodySchema.parse(req.body)
    const item = await updateFinansKalemi(req.auth!.tenantId, req.auth!.sub, id, body)
    res.json({ ok: true, item })
  })
)

finansKalemleriRouter.post(
  '/:id/archive',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const item = await archiveFinansKalemi(req.auth!.tenantId, req.auth!.sub, id)
    res.json({ ok: true, item })
  })
)

finansKalemleriRouter.post(
  '/:id/activate',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const item = await activateFinansKalemi(req.auth!.tenantId, req.auth!.sub, id)
    res.json({ ok: true, item })
  })
)
