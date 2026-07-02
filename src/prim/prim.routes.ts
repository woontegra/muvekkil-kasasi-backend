import type { Request, Response, NextFunction } from 'express'

import { Router } from 'express'

import { UserRole } from '@prisma/client'

import { z } from 'zod'

import { requireAuth } from '../middleware/requireAuth.js'

import { requireRole } from '../middleware/requireRole.js'

import {

  createPrimKuralBodySchema,

  markPrimOdendiBodySchema,

  primRaporQuerySchema,

  personelPanelOzetQuerySchema,

  personelPanelDetayQuerySchema,

  updatePrimKuralBodySchema

} from './prim.schemas.js'

import {

  createPrimKurali,

  getPrimRaporDetay,

  hesaplaPrimRaporu,

  listPrimKurallari,

  listPrimRaporOzet,

  listPersonelPrimOzet,

  getPersonelPrimPanel,

  markPrimOdendi,

  pasifPrimKurali,

  updatePrimKurali

} from './prim.service.js'



export const primRouter = Router()



/** Primler modülü yalnızca büro sahibi (ana kullanıcı) tarafından kullanılır. */

const BURO_SAHIBI_ONLY = [UserRole.BURO_SAHIBI] as const

const idParamSchema = z.object({ id: z.string().uuid() })



function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {

  return (req: Request, res: Response, next: NextFunction) => {

    void fn(req, res, next).catch(next)

  }

}



primRouter.get(

  '/kurallar',

  requireAuth,

  requireRole(...BURO_SAHIBI_ONLY),

  asyncHandler(async (req, res) => {

    const tenantId = req.auth!.tenantId

    const items = await listPrimKurallari(tenantId)

    res.json({ ok: true, items })

  })

)



primRouter.post(

  '/kurallar',

  requireAuth,

  requireRole(...BURO_SAHIBI_ONLY),

  asyncHandler(async (req, res) => {

    const tenantId = req.auth!.tenantId

    const body = createPrimKuralBodySchema.parse(req.body)

    const kural = await createPrimKurali(tenantId, body)

    res.status(201).json({ ok: true, kural })

  })

)



primRouter.put(

  '/kurallar/:id',

  requireAuth,

  requireRole(...BURO_SAHIBI_ONLY),

  asyncHandler(async (req, res) => {

    const { id } = idParamSchema.parse(req.params)

    const tenantId = req.auth!.tenantId

    const body = updatePrimKuralBodySchema.parse(req.body)

    const kural = await updatePrimKurali(tenantId, id, body)

    res.json({ ok: true, kural })

  })

)



primRouter.post(

  '/kurallar/:id/pasif',

  requireAuth,

  requireRole(...BURO_SAHIBI_ONLY),

  asyncHandler(async (req, res) => {

    const { id } = idParamSchema.parse(req.params)

    const tenantId = req.auth!.tenantId

    const kural = await pasifPrimKurali(tenantId, id)

    res.json({ ok: true, kural })

  })

)



primRouter.get(

  '/personel-ozet',

  requireAuth,

  requireRole(...BURO_SAHIBI_ONLY),

  asyncHandler(async (req, res) => {

    const tenantId = req.auth!.tenantId

    const query = personelPanelOzetQuerySchema.parse(req.query)

    const items = await listPersonelPrimOzet(tenantId, req.auth!.sub, req.auth!.role, query)

    res.json({ ok: true, items })

  })

)



primRouter.get(

  '/personel/:primPersonelId/panel',

  requireAuth,

  requireRole(...BURO_SAHIBI_ONLY),

  asyncHandler(async (req, res) => {

    const { primPersonelId } = z.object({ primPersonelId: z.string().uuid() }).parse(req.params)

    const tenantId = req.auth!.tenantId

    const query = personelPanelDetayQuerySchema.parse(req.query)

    const panel = await getPersonelPrimPanel(tenantId, req.auth!.sub, req.auth!.role, primPersonelId, query)

    res.json({ ok: true, panel })

  })

)



primRouter.get(

  '/rapor',

  requireAuth,

  requireRole(...BURO_SAHIBI_ONLY),

  asyncHandler(async (req, res) => {

    const tenantId = req.auth!.tenantId

    const query = primRaporQuerySchema.parse(req.query)

    const items = await listPrimRaporOzet(tenantId, req.auth!.sub, req.auth!.role, query)

    res.json({ ok: true, items })

  })

)



primRouter.post(

  '/rapor/hesapla',

  requireAuth,

  requireRole(...BURO_SAHIBI_ONLY),

  asyncHandler(async (req, res) => {

    const tenantId = req.auth!.tenantId

    const query = primRaporQuerySchema.parse(req.body)

    const items = await hesaplaPrimRaporu(tenantId, req.auth!.sub, req.auth!.role, query)

    res.json({ ok: true, items })

  })

)



primRouter.get(

  '/rapor/:id/detay',

  requireAuth,

  requireRole(...BURO_SAHIBI_ONLY),

  asyncHandler(async (req, res) => {

    const { id } = idParamSchema.parse(req.params)

    const tenantId = req.auth!.tenantId

    const detay = await getPrimRaporDetay(tenantId, req.auth!.sub, req.auth!.role, id)

    res.json({ ok: true, detay })

  })

)



primRouter.post(

  '/rapor/:id/odendi',

  requireAuth,

  requireRole(...BURO_SAHIBI_ONLY),

  asyncHandler(async (req, res) => {

    const { id } = idParamSchema.parse(req.params)

    const tenantId = req.auth!.tenantId

    const body = markPrimOdendiBodySchema.parse(req.body ?? {})

    const result = await markPrimOdendi(tenantId, req.auth!.sub, req.auth!.role, id, body.not)

    res.json({ ok: true, result })

  })

)

