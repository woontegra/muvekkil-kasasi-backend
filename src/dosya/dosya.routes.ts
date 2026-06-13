import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { updateDosyaBodySchema } from './dosya.schemas.js'
import { deactivateDosya, getDosyaHesapOzetiForTenant, getDosyaMakbuzlariForTenant, getDosyaWithMuvekkilForTenant, serializeDosya, updateDosya } from './dosya.service.js'
import { serializeMuvekkil } from '../muvekkil/muvekkil.service.js'
import {
  createKasaHareketiBodySchema,
  listKasaHareketleriQuerySchema
} from '../kasa/kasa.schemas.js'
import {
  createKasaHareketi,
  getKasaOzet,
  listKasaHareketleri,
  serializeKasaHareketi
} from '../kasa/kasa.service.js'
import {
  upsertVekaletUcretiBodySchema,
  createVekaletTaksitiBodySchema
} from '../vekalet/vekalet.schemas.js'
import {
  createVekaletTaksiti,
  getDosyaVekaletPackage,
  upsertVekaletUcreti
} from '../vekalet/vekalet.service.js'

export const dosyalarRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

dosyalarRouter.get(
  '/:id/kasa-hareketleri',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const query = listKasaHareketleriQuerySchema.parse({
      q: req.query.q,
      tip: req.query.tip,
      onayDurumu: req.query.onayDurumu,
      page: req.query.page,
      limit: req.query.limit
    })
    const result = await listKasaHareketleri(tenantId, dosyaId, query)
    if (!result) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Dosya bulunamadı.' })
      return
    }
    res.json({
      ok: true,
      items: result.items.map((h) => serializeKasaHareketi(h)),
      total: result.total,
      page: query.page,
      limit: query.limit
    })
  })
)

dosyalarRouter.post(
  '/:id/kasa-hareketleri',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL),
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const body = createKasaHareketiBodySchema.parse(req.body)
    const created = await createKasaHareketi(tenantId, userId, dosyaId, body, req)
    res.status(201).json({ ok: true, kasaHareketi: serializeKasaHareketi({ ...created, orijinalHareket: null }) })
  })
)

dosyalarRouter.get(
  '/:id/vekalet',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const pack = await getDosyaVekaletPackage(tenantId, dosyaId)
    if (!pack) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Dosya bulunamadı.' })
      return
    }
    res.json({ ok: true, ...pack })
  })
)

dosyalarRouter.post(
  '/:id/vekalet',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI),
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const body = upsertVekaletUcretiBodySchema.parse(req.body)
    const vekaletUcreti = await upsertVekaletUcreti(tenantId, userId, dosyaId, body, req)
    res.json({ ok: true, vekaletUcreti })
  })
)

dosyalarRouter.post(
  '/:id/vekalet/taksitler',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL),
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const body = createVekaletTaksitiBodySchema.parse(req.body)
    const taksit = await createVekaletTaksiti(tenantId, userId, dosyaId, body, req)
    res.status(201).json({ ok: true, taksit })
  })
)

dosyalarRouter.get(
  '/:id/kasa-ozet',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const ozet = await getKasaOzet(tenantId, dosyaId)
    if (!ozet) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Dosya bulunamadı.' })
      return
    }
    res.json({ ok: true, ozet })
  })
)

dosyalarRouter.get(
  '/:id/hesap-ozeti',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const data = await getDosyaHesapOzetiForTenant(tenantId, dosyaId)
    if (!data) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Dosya bulunamadı.' })
      return
    }
    res.json({ ok: true, ...data })
  })
)

dosyalarRouter.get(
  '/:id/makbuzlar',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const data = await getDosyaMakbuzlariForTenant(tenantId, dosyaId)
    if (!data) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Dosya bulunamadı.' })
      return
    }
    res.json({ ok: true, ...data })
  })
)

dosyalarRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const row = await getDosyaWithMuvekkilForTenant(tenantId, id)
    if (!row) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Dosya bulunamadı.' })
      return
    }
    res.json({
      ok: true,
      dosya: serializeDosya(row.dosya),
      muvekkil: serializeMuvekkil(row.muvekkil)
    })
  })
)

dosyalarRouter.put(
  '/:id',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = updateDosyaBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const updated = await updateDosya(tenantId, userId, id, body, req)
    res.json({ ok: true, dosya: serializeDosya(updated) })
  })
)

dosyalarRouter.delete(
  '/:id',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    await deactivateDosya(tenantId, userId, id, req)
    res.status(204).send()
  })
)
