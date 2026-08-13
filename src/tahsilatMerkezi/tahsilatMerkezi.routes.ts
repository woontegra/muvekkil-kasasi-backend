import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { manualSmsRateLimit } from '../middleware/rateLimits.js'
import { requireRole } from '../middleware/requireRole.js'
import { prisma } from '../lib/prisma.js'
import { prepareManualWhatsApp, previewManualWhatsApp } from '../tahsilatBildirim/manualWhatsApp.service.js'
import { getManualSmsPreview, sendManualSms } from './manualSms.service.js'
import { getTahsilatMerkeziOzet, listTahsilatMerkezi } from './tahsilatMerkezi.service.js'

export const tahsilatMerkeziRouter = Router()

const TAHSILAT_ROLLER = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL] as const

const gorunumSchema = z
  .enum(['GECIKENLER', 'BUGUN', 'YAKLASANLAR', 'KISMI_ODENENLER', 'TUMU'])
  .optional()

const durumSchema = z.enum(['ODENMEDI', 'KISMI_ODENDI', 'GECIKTI', 'ODENDI']).optional()

const listeQuerySchema = z.object({
  gorunum: gorunumSchema,
  muvekkilId: z.string().uuid().optional(),
  dosyaId: z.string().uuid().optional(),
  vadeBas: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  vadeBit: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  durum: durumSchema,
  personelId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
})

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

async function resolvePersonelBagliUserId(
  tenantId: string,
  personelId: string | undefined
): Promise<string | null> {
  if (!personelId) return null
  const p = await prisma.primPersonel.findFirst({
    where: { id: personelId, tenantId },
    select: { bagliUserId: true }
  })
  return p?.bagliUserId ?? null
}

tahsilatMerkeziRouter.get(
  '/ozet',
  requireAuth,
  requireRole(...TAHSILAT_ROLLER),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const personelId = typeof req.query.personelId === 'string' ? req.query.personelId : undefined
    const bagliUserId = await resolvePersonelBagliUserId(tenantId, personelId)
    const ozet = await getTahsilatMerkeziOzet(tenantId, personelId, bagliUserId)
    res.json({ ok: true, ozet })
  })
)

const manualWaBodySchema = z.object({
  mesaj: z.string().min(10).max(2000),
  idempotencyKey: z.string().min(8).max(128),
  openDeepLink: z.boolean().optional()
})

const manualSmsBodySchema = z.object({
  mesaj: z.string().min(10).max(2000),
  idempotencyKey: z.string().min(8).max(128)
})

tahsilatMerkeziRouter.get(
  '/:taksitId/manual-whatsapp/preview',
  requireAuth,
  requireRole(...TAHSILAT_ROLLER),
  asyncHandler(async (req, res) => {
    const taksitId = z.string().uuid().parse(req.params.taksitId)
    const preview = await previewManualWhatsApp(req.auth!.tenantId, taksitId)
    res.json({ ok: true, ...preview })
  })
)

tahsilatMerkeziRouter.post(
  '/:taksitId/manual-whatsapp/prepare',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI),
  manualSmsRateLimit,
  asyncHandler(async (req, res) => {
    const taksitId = z.string().uuid().parse(req.params.taksitId)
    const body = manualWaBodySchema.parse(req.body)
    const result = await prepareManualWhatsApp({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.sub,
      taksitId,
      mesaj: body.mesaj,
      idempotencyKey: body.idempotencyKey,
      openDeepLink: body.openDeepLink,
      req
    })
    res.json(result)
  })
)

tahsilatMerkeziRouter.get(
  '/:taksitId/manual-sms/preview',
  requireAuth,
  requireRole(...TAHSILAT_ROLLER),
  asyncHandler(async (req, res) => {
    const taksitId = z.string().uuid().parse(req.params.taksitId)
    const preview = await getManualSmsPreview(req.auth!.tenantId, taksitId)
    res.json({ ok: true, ...preview })
  })
)

tahsilatMerkeziRouter.post(
  '/:taksitId/manual-sms/send',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI),
  manualSmsRateLimit,
  asyncHandler(async (req, res) => {
    const taksitId = z.string().uuid().parse(req.params.taksitId)
    const body = manualSmsBodySchema.parse(req.body)
    const result = await sendManualSms({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.sub,
      taksitId,
      mesaj: body.mesaj,
      idempotencyKey: body.idempotencyKey,
      req
    })
    res.json(result)
  })
)

tahsilatMerkeziRouter.get(
  '/liste',
  requireAuth,
  requireRole(...TAHSILAT_ROLLER),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const q = listeQuerySchema.parse(req.query)
    const bagliUserId = await resolvePersonelBagliUserId(tenantId, q.personelId)
    const data = await listTahsilatMerkezi(tenantId, { ...q, personelBagliUserId: bagliUserId })
    res.json({ ok: true, ...data })
  })
)
