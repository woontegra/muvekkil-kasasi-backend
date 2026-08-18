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

const customTemplateSchema = z.object({
  displayName: z.string().min(3).max(120),
  metaName: z.string().min(3).max(120),
  usageArea: z.enum([
    'VADEDEN_ONCE',
    'VADE_GUNU',
    'VADE_SONRASI',
    'KISMI_ODEME_SONRASI',
    'ODEME_ALINDI',
    'RANDEVU_HATIRLATMA',
    'MANUEL'
  ]),
  category: z.enum(['UTILITY', 'MARKETING']),
  language: z.literal('tr'),
  bodyText: z.string().min(1).max(4000),
  footerText: z.string().max(60).optional().nullable(),
  variables: z.array(
    z.object({
      index: z.number().int().min(1).max(20),
      systemField: z.enum([
        'muvekkilAdi',
        'dosyaNumarasi',
        'taksitTutari',
        'kalanTutar',
        'vadeTarihi',
        'odenenTutar',
        'odemeTarihi',
        'randevuTarihi',
        'randevuSaati',
        'buroAdi',
        'buroTelefon'
      ]),
      exampleValue: z.string().min(1).max(200)
    })
  )
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
  '/ozel-sablonlar',
  requireAuth,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const { listCustomTemplatesForTenant } = await import('./customTemplate.service.js')
    const templates = await listCustomTemplatesForTenant(req.auth!.tenantId)
    res.json({ ok: true, templates })
  })
)

whatsappBaglantiRouter.post(
  '/ozel-sablonlar',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const body = customTemplateSchema.parse(req.body ?? {})
    const { createCustomTemplateDraft } = await import('./customTemplate.service.js')
    const template = await createCustomTemplateDraft(req.auth!.tenantId, req.auth!.sub, body, req)
    res.json({ ok: true, template })
  })
)

whatsappBaglantiRouter.patch(
  '/ozel-sablonlar/:id',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const body = customTemplateSchema.parse(req.body ?? {})
    const { updateCustomTemplateDraft } = await import('./customTemplate.service.js')
    const template = await updateCustomTemplateDraft(req.auth!.tenantId, req.auth!.sub, id, body, req)
    res.json({ ok: true, template })
  })
)

whatsappBaglantiRouter.delete(
  '/ozel-sablonlar/:id',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const { deleteCustomTemplateDraft } = await import('./customTemplate.service.js')
    const result = await deleteCustomTemplateDraft(req.auth!.tenantId, req.auth!.sub, id, req)
    res.json(result)
  })
)

whatsappBaglantiRouter.post(
  '/ozel-sablonlar/:id/meta-onayina-gonder',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const { submitCustomTemplateToMeta } = await import('./customTemplate.service.js')
    const template = await submitCustomTemplateToMeta(req.auth!.tenantId, req.auth!.sub, id, req)
    res.json({ ok: true, template })
  })
)

whatsappBaglantiRouter.post(
  '/ozel-sablonlar/:id/kopyala-ozellestir',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const { duplicateTemplateAsDraft } = await import('./customTemplate.service.js')
    const template = await duplicateTemplateAsDraft(req.auth!.tenantId, req.auth!.sub, id, req)
    res.json({ ok: true, template })
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

whatsappBaglantiRouter.post(
  '/hazir-sablon-kutuphanesi/:libraryKey/kopyala-ozellestir',
  requireAuth,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const libraryKey = z.string().min(1).max(64).parse(req.params.libraryKey)
    const { duplicateLibraryTemplateAsDraft } = await import('./customTemplate.service.js')
    const template = await duplicateLibraryTemplateAsDraft(
      req.auth!.tenantId,
      req.auth!.sub,
      libraryKey,
      req
    )
    res.json({ ok: true, template })
  })
)

whatsappBaglantiRouter.get(
  '/onayli-sablonlar',
  requireAuth,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const q = z
      .object({ kuralTuru: z.enum(['VADEDEN_ONCE', 'VADE_GUNU', 'VADE_SONRASI']).optional() })
      .parse(req.query)
    const { listApprovedTemplatesForAutomation } = await import('./templateLibrary.service.js')
    const templates = await listApprovedTemplatesForAutomation(req.auth!.tenantId, {
      kuralTuru: q.kuralTuru
    })
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
