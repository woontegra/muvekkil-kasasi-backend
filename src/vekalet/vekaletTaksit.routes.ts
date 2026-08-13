import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { prisma } from '../lib/prisma.js'
import {
  markTaksitPaidBodySchema,
  markTaksitSmmBodySchema,
  updateVekaletTaksitiBodySchema,
  createVekaletTaksitOdemeBodySchema
} from './vekalet.schemas.js'
import {
  deleteVekaletTaksiti,
  markVekaletTaksitPaid,
  markVekaletTaksitSmm,
  serializeTaksitApiResponse,
  updateVekaletTaksiti
} from './vekalet.service.js'
import { createVekaletTaksitOdeme, listVekaletTaksitOdemeler } from './vekaletTaksitOdeme.service.js'
import {
  getTaksitBildirimAyar,
  setTaksitOtomatikBildirim
} from '../tahsilatBildirim/bildirimAyar.service.js'

export const vekaletTaksitleriRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })

const ODEME_ROLLER = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL] as const
const YONETICI = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI] as const

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
    const taksit = await createVekaletTaksitOdeme(tenantId, userId, req.auth!.role, id, body, req)
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

const taksitBildirimAyarBodySchema = z.object({
  otomatikBildirimAktif: z.boolean()
})

vekaletTaksitleriRouter.get(
  '/:id/bildirim-ayar',
  requireAuth,
  requireRole(...ODEME_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const data = await getTaksitBildirimAyar(req.auth!.tenantId, id)
    res.json({ ok: true, ...data })
  })
)

vekaletTaksitleriRouter.patch(
  '/:id/bildirim-ayar',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = taksitBildirimAyarBodySchema.parse(req.body)
    const result = await setTaksitOtomatikBildirim(
      req.auth!.tenantId,
      req.auth!.sub,
      id,
      body.otomatikBildirimAktif,
      req
    )
    const row = await prisma.vekaletTaksiti.findFirst({
      where: { id, tenantId: req.auth!.tenantId }
    })
    const taksit = row ? await serializeTaksitApiResponse(row) : null
    res.json({ ok: true, ...result, taksit })
  })
)

const taksitHatirlatmaPlanBodySchema = z.object({
  mode: z.enum(['VARSAYILAN', 'OZEL', 'KAPALI']),
  kurallar: z
    .array(
      z.object({
        kuralTuru: z.enum(['VADEDEN_ONCE', 'VADE_GUNU', 'VADE_SONRASI']),
        aktifMi: z.boolean(),
        gunOffset: z.number().int().min(0).max(365),
        gonderimSaatiDk: z.number().int().min(0).max(1439),
        metaSablonId: z.string().uuid().nullable()
      })
    )
    .optional()
})

vekaletTaksitleriRouter.get(
  '/:id/hatirlatma-plan',
  requireAuth,
  requireRole(...ODEME_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const { getTaksitHatirlatmaPlan } = await import('../tahsilatBildirim/bildirimPlan.service.js')
    const data = await getTaksitHatirlatmaPlan(req.auth!.tenantId, id)
    res.json({ ok: true, ...data })
  })
)

vekaletTaksitleriRouter.patch(
  '/:id/hatirlatma-plan',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = taksitHatirlatmaPlanBodySchema.parse(req.body)
    const { setTaksitHatirlatmaPlan } = await import('../tahsilatBildirim/bildirimPlan.service.js')
    const result = await setTaksitHatirlatmaPlan({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.sub,
      taksitId: id,
      mode: body.mode,
      kurallar: body.kurallar,
      req
    })
    res.json({ ok: true, ...result })
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
    const taksit = await markVekaletTaksitPaid(tenantId, userId, req.auth!.role, id, body, req)
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
  requireRole(...ODEME_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const result = await deleteVekaletTaksiti(tenantId, userId, id, req)
    res.json(result)
  })
)
