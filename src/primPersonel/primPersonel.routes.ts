import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  createPrimPersonelBodySchema,
  linkKullanicilarQuerySchema,
  listPrimPersonelQuerySchema,
  updatePrimPersonelBodySchema
} from './primPersonel.schemas.js'
import {
  createPrimPersonel,
  getPrimPersonelForActor,
  getLinkedPrimPersonelForUser,
  listActivePrimPersonelForSelect,
  listLinkKullanicilarForPrimPersonel,
  listPrimPersoneller,
  updatePrimPersonel
} from './primPersonel.service.js'
import { serializePrimPersonel } from './primPersonel.service.js'

export const primPersonelRouter = Router()

const BURO_SAHIBI_ONLY = [UserRole.BURO_SAHIBI] as const
const idParamSchema = z.object({ id: z.string().uuid() })

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

primPersonelRouter.get(
  '/',
  requireAuth,
  requireRole(...BURO_SAHIBI_ONLY),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const query = listPrimPersonelQuerySchema.parse(req.query)
    const result = await listPrimPersoneller(tenantId, req.auth!.sub, req.auth!.role, query)
    res.json({ ok: true, ...result })
  })
)

primPersonelRouter.get(
  '/aktif',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const items = await listActivePrimPersonelForSelect(tenantId)
    res.json({ ok: true, items })
  })
)

primPersonelRouter.get(
  '/bagli-ben',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const personel = await getLinkedPrimPersonelForUser(tenantId, req.auth!.sub)
    res.json({ ok: true, personel })
  })
)

primPersonelRouter.get(
  '/link-kullanicilar',
  requireAuth,
  requireRole(...BURO_SAHIBI_ONLY),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const query = linkKullanicilarQuerySchema.parse(req.query)
    const items = await listLinkKullanicilarForPrimPersonel(tenantId, query.exceptPersonelId)
    res.json({ ok: true, items })
  })
)

primPersonelRouter.post(
  '/',
  requireAuth,
  requireRole(...BURO_SAHIBI_ONLY),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const body = createPrimPersonelBodySchema.parse(req.body)
    const result = await createPrimPersonel(tenantId, body)
    res.status(201).json({ ok: true, ...result })
  })
)

primPersonelRouter.put(
  '/:id',
  requireAuth,
  requireRole(...BURO_SAHIBI_ONLY),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const body = updatePrimPersonelBodySchema.parse(req.body)
    const personel = await updatePrimPersonel(tenantId, id, body)
    res.json({ ok: true, personel })
  })
)

primPersonelRouter.get(
  '/:id',
  requireAuth,
  requireRole(...BURO_SAHIBI_ONLY),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    await getPrimPersonelForActor(tenantId, req.auth!.sub, req.auth!.role, id)
    const { prisma } = await import('../lib/prisma.js')
    const row = await prisma.primPersonel.findFirstOrThrow({
      where: { id, tenantId },
      include: { bagliUser: { select: { id: true, adSoyad: true } } }
    })
    res.json({ ok: true, personel: serializePrimPersonel(row) })
  })
)
