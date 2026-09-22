import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { updateDosyaBodySchema } from './dosya.schemas.js'
import { deactivateDosya, getDosyaHesapOzetiForTenant, getDosyaMakbuzlariForTenant, getDosyaWithMuvekkilForTenant, serializeDosya, updateDosya } from './dosya.service.js'
import { getDosyaMaliOzet } from './dosyaMaliOzet.service.js'
import { serializeMuvekkil } from '../muvekkil/muvekkil.service.js'
import {
  getDosyaBildirimAyar,
  setDosyaOtomatikBildirim
} from '../tahsilatBildirim/bildirimAyar.service.js'
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
  createVekaletTaksitiBodySchema,
  createVekaletPesinOdemeBodySchema,
  createVekaletTaksitPlaniBodySchema,
  createTekVekaletTaksitiBodySchema
} from '../vekalet/vekalet.schemas.js'
import {
  createTekVekaletTaksiti,
  createVekaletTaksitPlani,
  createVekaletTaksiti,
  getDosyaVekaletPackage,
  upsertVekaletUcreti
} from '../vekalet/vekalet.service.js'
import { createVekaletPesinOdeme } from '../vekalet/vekaletTaksitOdeme.service.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { muvekkilEkstreRouter } from '../muvekkilEkstre/muvekkilEkstre.routes.js'

export const dosyalarRouter = Router()

dosyalarRouter.use('/:id/muvekkil-ekstresi', muvekkilEkstreRouter)

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
      startDate: req.query.startDate,
      endDate: req.query.endDate,
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
    const created = await createKasaHareketi(tenantId, userId, req.auth!.role, dosyaId, body, req)
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

dosyalarRouter.get(
  '/:id/vekalet/sil-etki-analizi',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.status(410).json({
      ok: false,
      error: 'FEATURE_DISABLED',
      message: 'Vekalet ücretinin tamamını silme özelliği kaldırıldı. Yalnız taksit veya tahsilat satırı silinebilir.'
    })
  })
)

dosyalarRouter.post(
  '/:id/vekalet/guvenli-sil',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.status(410).json({
      ok: false,
      error: 'FEATURE_DISABLED',
      message: 'Vekalet ücretinin tamamını silme özelliği kaldırıldı. Yalnız taksit veya tahsilat satırı silinebilir.'
    })
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

dosyalarRouter.post(
  '/:id/vekalet/tek-taksit',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL),
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const body = createTekVekaletTaksitiBodySchema.parse(req.body)
    const taksit = await createTekVekaletTaksiti(tenantId, userId, dosyaId, body, req)
    res.status(201).json({ ok: true, taksit })
  })
)

dosyalarRouter.post(
  '/:id/vekalet/taksit-plani',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL),
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const body = createVekaletTaksitPlaniBodySchema.parse(req.body)
    const result = await createVekaletTaksitPlani(tenantId, userId, dosyaId, body, req)
    res.status(201).json(result)
  })
)

dosyalarRouter.post(
  '/:id/vekalet/pesin-odeme',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL),
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const body = createVekaletPesinOdemeBodySchema.parse(req.body)
    const result = await createVekaletPesinOdeme(tenantId, userId, req.auth!.role, dosyaId, body, req)
    res.status(201).json(result)
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
  '/:id/mali-ozet',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const periodPreset =
      typeof req.query.periodPreset === 'string' && req.query.periodPreset.trim()
        ? (req.query.periodPreset.trim() as import('../lib/financePeriodRange.js').FinancePeriodPreset)
        : undefined
    const bas = typeof req.query.bas === 'string' ? req.query.bas : undefined
    const bit = typeof req.query.bit === 'string' ? req.query.bit : undefined
    const data = await getDosyaMaliOzet(tenantId, dosyaId, {
      periodPreset,
      bas,
      bit
    })
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

const dosyaBildirimAyarBodySchema = z.object({
  otomatikBildirimAktif: z.boolean()
})

dosyalarRouter.get(
  '/:id/bildirim-ayar',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const data = await getDosyaBildirimAyar(req.auth!.tenantId, id)
    res.json({ ok: true, ...data })
  })
)

dosyalarRouter.patch(
  '/:id/bildirim-ayar',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = dosyaBildirimAyarBodySchema.parse(req.body)
    const result = await setDosyaOtomatikBildirim(
      req.auth!.tenantId,
      req.auth!.sub,
      id,
      body.otomatikBildirimAktif,
      req
    )
    const row = await getDosyaWithMuvekkilForTenant(req.auth!.tenantId, id)
    res.json({
      ok: true,
      ...result,
      dosya: row ? serializeDosya(row.dosya) : null
    })
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
