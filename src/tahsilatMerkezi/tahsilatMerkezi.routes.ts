import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { prisma } from '../lib/prisma.js'
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
  limit: z.coerce.number().int().min(1).max(200).optional()
})

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

async function resolvePersonelBagliUserId(personelId: string | undefined): Promise<string | null> {
  if (!personelId) return null
  const p = await prisma.primPersonel.findUnique({
    where: { id: personelId },
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
    const bagliUserId = await resolvePersonelBagliUserId(personelId)
    const ozet = await getTahsilatMerkeziOzet(tenantId, personelId, bagliUserId)
    res.json({ ok: true, ozet })
  })
)

tahsilatMerkeziRouter.get(
  '/liste',
  requireAuth,
  requireRole(...TAHSILAT_ROLLER),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const q = listeQuerySchema.parse(req.query)
    const bagliUserId = await resolvePersonelBagliUserId(q.personelId)
    const data = await listTahsilatMerkezi(tenantId, { ...q, personelBagliUserId: bagliUserId })
    res.json({ ok: true, ...data })
  })
)
