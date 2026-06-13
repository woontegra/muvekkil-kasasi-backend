import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { createMuvekkilBodySchema, listMuvekkilQuerySchema, updateMuvekkilBodySchema } from './muvekkil.schemas.js'
import {
  createMuvekkil,
  deactivateMuvekkil,
  getMuvekkilById,
  listMuvekkiller,
  serializeMuvekkil,
  updateMuvekkil
} from './muvekkil.service.js'
import { createDosyaBodySchema, listDosyaForMuvekkilQuerySchema } from '../dosya/dosya.schemas.js'
import { createDosya, listDosyalarForMuvekkil, serializeDosya } from '../dosya/dosya.service.js'

export const muvekkillerRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })
const muvekkilIdParamSchema = z.object({ muvekkilId: z.string().uuid('Geçersiz müvekkil id.') })

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

muvekkillerRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const query = listMuvekkilQuerySchema.parse({
      q: req.query.q,
      tur: req.query.tur,
      page: req.query.page,
      limit: req.query.limit
    })
    const { items, total } = await listMuvekkiller(tenantId, query)
    res.json({
      ok: true,
      items: items.map((m) => serializeMuvekkil(m)),
      total,
      page: query.page,
      limit: query.limit
    })
  })
)

muvekkillerRouter.get(
  '/:muvekkilId/dosyalar',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { muvekkilId } = muvekkilIdParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const query = listDosyaForMuvekkilQuerySchema.parse({
      q: req.query.q,
      durum: req.query.durum,
      dosyaTuru: req.query.dosyaTuru,
      page: req.query.page,
      limit: req.query.limit
    })
    const result = await listDosyalarForMuvekkil(tenantId, muvekkilId, query)
    if (!result) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Müvekkil bulunamadı.' })
      return
    }
    res.json({
      ok: true,
      items: result.items.map((d) => serializeDosya(d)),
      total: result.total,
      page: query.page,
      limit: query.limit
    })
  })
)

muvekkillerRouter.post(
  '/:muvekkilId/dosyalar',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL),
  asyncHandler(async (req, res) => {
    const { muvekkilId } = muvekkilIdParamSchema.parse(req.params)
    const body = createDosyaBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const created = await createDosya(tenantId, userId, muvekkilId, body, req)
    res.status(201).json({ ok: true, dosya: serializeDosya(created) })
  })
)

muvekkillerRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const row = await getMuvekkilById(tenantId, id)
    if (!row) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Müvekkil bulunamadı.' })
      return
    }
    res.json({ ok: true, muvekkil: serializeMuvekkil(row) })
  })
)

muvekkillerRouter.post(
  '/',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL),
  asyncHandler(async (req, res) => {
    const body = createMuvekkilBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const created = await createMuvekkil(tenantId, userId, body, req)
    res.status(201).json({ ok: true, muvekkil: serializeMuvekkil(created) })
  })
)

muvekkillerRouter.put(
  '/:id',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = updateMuvekkilBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const updated = await updateMuvekkil(tenantId, userId, id, body, req)
    res.json({ ok: true, muvekkil: serializeMuvekkil(updated) })
  })
)

muvekkillerRouter.delete(
  '/:id',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    await deactivateMuvekkil(tenantId, userId, id, req)
    res.status(204).send()
  })
)
