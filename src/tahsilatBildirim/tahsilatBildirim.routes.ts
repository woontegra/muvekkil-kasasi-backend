import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { getBildirimOzet, listBildirimIsleri } from './list.service.js'
import { planJobsForTenant } from './planner.service.js'
import {
  getSettings,
  getWhatsAppDurum,
  updateRule,
  updateSettings,
  updateTemplate
} from './settings.service.js'
import { markBildirimJobSent, openBildirimJobWhatsApp } from './bildirimJobWhatsApp.service.js'
import { simulateTodaysJobs } from './simulate.service.js'

export const tahsilatBildirimRouter = Router()

const YONETICI = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI] as const
const OKUMA = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL] as const

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

const updateAyarSchema = z.object({
  otomasyonAktif: z.boolean().optional(),
  testModu: z.boolean().optional(),
  izinliSaatBaslangic: z.number().int().min(0).max(1439).optional(),
  izinliSaatBitis: z.number().int().min(0).max(1439).optional()
})

const updateKuralSchema = z.object({
  aktifMi: z.boolean().optional(),
  gunOffset: z.number().int().min(0).max(365).optional(),
  gonderimSaatiDk: z.number().int().min(0).max(1439).optional()
})

const updateSablonSchema = z.object({
  metin: z.string().min(10).max(4000)
})

const listeQuerySchema = z.object({
  gorunum: z.enum(['PLANLANANLAR', 'BUGUN', 'GECMIS', 'ATLANANLAR']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
})

tahsilatBildirimRouter.get(
  '/ayarlar',
  requireAuth,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const data = await getSettings(req.auth!.tenantId)
    res.json({ ok: true, ...data })
  })
)

tahsilatBildirimRouter.patch(
  '/ayarlar',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const body = updateAyarSchema.parse(req.body)
    const ayar = await updateSettings(req.auth!.tenantId, req.auth!.sub, body, req)
    res.json({ ok: true, ayar })
  })
)

tahsilatBildirimRouter.patch(
  '/kurallar/:id',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const body = updateKuralSchema.parse(req.body)
    const kural = await updateRule(req.auth!.tenantId, req.auth!.sub, id, body, req)
    res.json({ ok: true, kural })
  })
)

tahsilatBildirimRouter.patch(
  '/sablonlar/:id',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const body = updateSablonSchema.parse(req.body)
    const sablon = await updateTemplate(req.auth!.tenantId, req.auth!.sub, id, body, req)
    res.json({ ok: true, sablon })
  })
)

tahsilatBildirimRouter.get(
  '/ozet',
  requireAuth,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const ozet = await getBildirimOzet(req.auth!.tenantId)
    res.json({ ok: true, ozet })
  })
)

tahsilatBildirimRouter.get(
  '/isler',
  requireAuth,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const q = listeQuerySchema.parse(req.query)
    const data = await listBildirimIsleri(req.auth!.tenantId, q)
    res.json({ ok: true, ...data })
  })
)

const whatsappAcSchema = z.object({
  mesaj: z.string().min(1).max(4000).optional()
})

tahsilatBildirimRouter.post(
  '/isler/:id/whatsapp-ac',
  requireAuth,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const jobId = z.string().uuid().parse(req.params.id)
    const body = whatsappAcSchema.parse(req.body ?? {})
    const result = await openBildirimJobWhatsApp({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.sub,
      jobId,
      req,
      mesaj: body.mesaj
    })
    res.json({ ok: true, ...result })
  })
)

tahsilatBildirimRouter.post(
  '/isler/:id/gonderildi-isaretle',
  requireAuth,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const jobId = z.string().uuid().parse(req.params.id)
    const result = await markBildirimJobSent({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.sub,
      jobId,
      req
    })
    res.json({ ok: true, ...result })
  })
)

tahsilatBildirimRouter.post(
  '/simule-et',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const ozet = await simulateTodaysJobs(req.auth!.tenantId, req.auth!.sub, req)
    res.json({ ok: true, ozet })
  })
)

tahsilatBildirimRouter.post(
  '/planla',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const result = await planJobsForTenant(req.auth!.tenantId)
    res.json({ ok: true, result })
  })
)

tahsilatBildirimRouter.get(
  '/whatsapp-durum',
  requireAuth,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const durum = await getWhatsAppDurum(req.auth!.tenantId)
    res.json({ ok: true, ...durum })
  })
)
