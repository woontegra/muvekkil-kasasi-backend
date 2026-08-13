import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  connectEmbeddedSignup,
  disconnectConnection,
  getConnectionDurum,
  getEmbeddedSignupPublicConfig,
  syncTemplates,
  verifyConnection
} from './connection.service.js'

/**
 * Tenant WhatsApp Cloud bağlantı REST.
 * Mount: /api/v1/whatsapp-baglanti  veya  /api/v1/tahsilat-bildirim/whatsapp-baglanti
 */
export const whatsappBaglantiRouter = Router()

const YONETICI = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI] as const
const OKUMA = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL] as const

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

const completeSchema = z.object({
  code: z.string().min(1).max(4000),
  wabaId: z.string().min(1).max(128),
  phoneNumberId: z.string().min(1).max(128),
  pin: z.string().min(4).max(16).optional()
})

whatsappBaglantiRouter.get(
  '/durum',
  requireAuth,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const durum = await getConnectionDurum(req.auth!.tenantId)
    res.json({ ok: true, ...durum })
  })
)

whatsappBaglantiRouter.get(
  '/embedded-signup-config',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (_req, res) => {
    const config = getEmbeddedSignupPublicConfig()
    res.json({ ok: true, ...config })
  })
)

whatsappBaglantiRouter.post(
  '/embedded-signup/complete',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const body = completeSchema.parse(req.body)
    const result = await connectEmbeddedSignup(
      req.auth!.tenantId,
      req.auth!.sub,
      body,
      req
    )
    res.json({ ok: true, ...result })
  })
)

whatsappBaglantiRouter.post(
  '/dogrula',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const result = await verifyConnection(req.auth!.tenantId, req.auth!.sub, req)
    res.json({ ok: true, ...result })
  })
)

whatsappBaglantiRouter.post(
  '/sablon-senkron',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const result = await syncTemplates(req.auth!.tenantId)
    res.json({ ok: true, ...result })
  })
)

whatsappBaglantiRouter.get(
  '/hazir-sablon-kutuphanesi',
  requireAuth,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const { listTemplateLibraryForTenant } = await import('./templateLibrary.service.js')
    const data = await listTemplateLibraryForTenant(req.auth!.tenantId)
    res.json({ ok: true, ...data })
  })
)

whatsappBaglantiRouter.post(
  '/hazir-sablon-kutuphanesi/:libraryKey/meta-onayina-gonder',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const libraryKey = z.string().min(1).max(64).parse(req.params.libraryKey)
    const { submitLibraryTemplateToMeta } = await import('./templateLibrary.service.js')
    const result = await submitLibraryTemplateToMeta(
      req.auth!.tenantId,
      req.auth!.sub,
      libraryKey,
      req
    )
    res.json(result)
  })
)

whatsappBaglantiRouter.get(
  '/onayli-sablonlar',
  requireAuth,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const { listApprovedTemplatesForAutomation } = await import('./templateLibrary.service.js')
    const templates = await listApprovedTemplatesForAutomation(req.auth!.tenantId)
    res.json({ ok: true, templates })
  })
)

whatsappBaglantiRouter.post(
  '/baglantiyi-kaldir',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const result = await disconnectConnection(req.auth!.tenantId, req.auth!.sub, req)
    res.json({ ok: true, ...result })
  })
)
