import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { WhatsAppMesajPaketTalepDurum } from '@prisma/client'
import { z } from 'zod'
import { serializeTenant } from '../auth/auth.service.js'
import { requireAdminAuth } from '../middleware/requireAdminAuth.js'
import { requireAdminRoles } from '../middleware/requireAdminRoles.js'
import { adminWhatsAppOutboundTestRateLimit } from '../middleware/rateLimits.js'
import { importExistingMetaConnection } from '../tahsilatBildirim/connection.importExisting.js'
import { sendAdminOutboundCloudTest } from '../tahsilatBildirim/connection.outboundTest.js'
import { sendControlledSessionCloudTextTest } from '../tahsilatBildirim/connection.controlledSessionTest.js'
import {
  disableAdminWhatsAppWebhookOverride,
  enableAdminWhatsAppWebhookOverride,
  getAdminWhatsAppWebhookOverrideStatus
} from './adminWhatsAppWebhookOverride.service.js'
import { adminAuthRouter } from './adminAuth.routes.js'
import { getAdminMe } from './adminAuth.service.js'
import { getAdminDashboardStats } from './adminDashboard.service.js'
import {
  adminExtendLicenseBodySchema,
  adminCreateTenantBodySchema,
  adminProfileUpdateSchema,
  adminResetPasswordBodySchema,
  adminSelfChangePasswordSchema,
  adminSuperAdminCreateSchema,
  adminSuperAdminResetPasswordBodySchema,
  adminSuperAdminUpdateSchema,
  adminTenantUpdateBodySchema,
  adminUserUpdateBodySchema,
  adminWhatsAppKrediAdjustSchema,
  adminWhatsAppPaketTalepResolveSchema
} from './admin.schemas.js'
import {
  adminAdjustTenantWhatsAppKredi,
  adminGetTenantWhatsAppKredi,
  adminListTenantWhatsAppKrediHareketler
} from './adminWhatsAppKredi.service.js'
import {
  adminListPaketTalepleri,
  adminOnaylaPaketTalebi,
  adminReddetPaketTalebi
} from './adminWhatsAppPaketTalep.service.js'
import {
  adminChangeOwnPassword,
  adminGetSettingsProfile,
  adminGetSystemInfo,
  adminUpdateSettingsProfile
} from './adminSettings.service.js'
import {
  adminCreateSuperAdmin,
  adminListSuperAdmins,
  adminResetSuperAdminPassword,
  adminSetSuperAdminActive,
  adminUpdateSuperAdmin
} from './adminSuperAdmin.service.js'
import {
  adminCreateTenantWithOwner,
  adminDeleteTenant,
  adminExtendTenantLicense,
  adminGetTenant,
  adminListExpiringTenants,
  adminListTenants,
  adminListTenantUsers,
  adminResetUserPassword,
  adminResendWelcomeActivationEmail,
  adminSetTenantActive,
  adminUpdateTenant,
  adminUpdateUser
} from './adminTenant.service.js'

export const adminRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

adminRouter.use('/auth', adminAuthRouter)

adminRouter.get(
  '/me',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    const me = await getAdminMe(req.adminAuth!.sub)
    if (!me) {
      res.status(401).json({ message: 'Admin bulunamadı veya pasif.', error: 'ADMIN_GONE' })
      return
    }
    res.json({ ok: true, adminUser: me })
  })
)

/** Platform personeli: SUPER_ADMIN, DESTEK, FINANS. */
const platformStaff = requireAdminRoles('SUPER_ADMIN', 'DESTEK', 'FINANS')
const superOnly = requireAdminRoles('SUPER_ADMIN')

adminRouter.get(
  '/settings/profile',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const profile = await adminGetSettingsProfile(req.adminAuth!.sub)
    res.json({ ok: true, profile })
  })
)

adminRouter.put(
  '/settings/profile',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const body = adminProfileUpdateSchema.parse(req.body)
    const profile = await adminUpdateSettingsProfile(req.adminAuth!.sub, body, req)
    res.json({ ok: true, profile })
  })
)

adminRouter.post(
  '/settings/change-password',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const body = adminSelfChangePasswordSchema.parse(req.body)
    await adminChangeOwnPassword(req.adminAuth!.sub, body, req)
    res.json({ ok: true })
  })
)

adminRouter.get(
  '/settings/system-info',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    res.json({ ok: true, ...adminGetSystemInfo(req) })
  })
)

adminRouter.get(
  '/admin-users',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (_req, res) => {
    const items = await adminListSuperAdmins()
    res.json({ ok: true, items })
  })
)

adminRouter.post(
  '/admin-users',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const body = adminSuperAdminCreateSchema.parse(req.body)
    const user = await adminCreateSuperAdmin(body, req.adminAuth!.sub, req)
    res.status(201).json({ ok: true, user })
  })
)

adminRouter.put(
  '/admin-users/:id',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const body = adminSuperAdminUpdateSchema.parse(req.body)
    const user = await adminUpdateSuperAdmin(id, body, req.adminAuth!.sub, req)
    res.json({ ok: true, user })
  })
)

adminRouter.post(
  '/admin-users/:id/reset-password',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const body = adminSuperAdminResetPasswordBodySchema.parse(req.body ?? {})
    const out = await adminResetSuperAdminPassword(id, body.yeniSifre, req.adminAuth!.sub, req)
    res.json({ ok: true, geciciSifre: out.geciciSifre })
  })
)

adminRouter.post(
  '/admin-users/:id/activate',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const user = await adminSetSuperAdminActive(id, true, req.adminAuth!.sub, req)
    res.json({ ok: true, user })
  })
)

adminRouter.post(
  '/admin-users/:id/deactivate',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const user = await adminSetSuperAdminActive(id, false, req.adminAuth!.sub, req)
    res.json({ ok: true, user })
  })
)

adminRouter.get(
  '/dashboard',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (_req, res) => {
    const stats = await getAdminDashboardStats()
    res.json({ ok: true, ...stats })
  })
)

adminRouter.get(
  '/tenants/expiring',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 7))
    const items = await adminListExpiringTenants(days)
    res.json({ ok: true, items, days })
  })
)

adminRouter.get(
  '/tenants',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined
    const lisansDurumu = typeof req.query.lisansDurumu === 'string' ? req.query.lisansDurumu : undefined
    const aktifMi =
      req.query.aktifMi === 'true' ? true : req.query.aktifMi === 'false' ? false : undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const out = await adminListTenants({ q, lisansDurumu, aktifMi, page, limit })
    res.json({ ok: true, ...out })
  })
)

adminRouter.post(
  '/tenants',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const body = adminCreateTenantBodySchema.parse(req.body)
    const out = await adminCreateTenantWithOwner(body, req.adminAuth!.sub, req)
    res.json({ ok: true, ...out })
  })
)

adminRouter.get(
  '/tenants/:id',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const out = await adminGetTenant(id)
    res.json({ ok: true, ...out })
  })
)

adminRouter.put(
  '/tenants/:id',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const body = adminTenantUpdateBodySchema.parse(req.body)
    const updated = await adminUpdateTenant(id, body, req.adminAuth!.role, req.adminAuth!.sub, req)
    res.json({ ok: true, tenant: serializeTenant(updated) })
  })
)

adminRouter.post(
  '/tenants/:id/extend-license',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const body = adminExtendLicenseBodySchema.parse(req.body)
    const updated = await adminExtendTenantLicense(id, body, req.adminAuth!.sub, req)
    res.json({ ok: true, tenant: serializeTenant(updated) })
  })
)

adminRouter.post(
  '/tenants/:id/activate',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const updated = await adminSetTenantActive(id, true, req.adminAuth!.sub, req)
    res.json({ ok: true, tenant: serializeTenant(updated) })
  })
)

adminRouter.post(
  '/tenants/:id/deactivate',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const updated = await adminSetTenantActive(id, false, req.adminAuth!.sub, req)
    res.json({ ok: true, tenant: serializeTenant(updated) })
  })
)

adminRouter.delete(
  '/tenants/:id',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    await adminDeleteTenant(id, req.adminAuth!.sub, req)
    res.json({ ok: true })
  })
)

adminRouter.post(
  '/tenants/:id/resend-welcome-mail',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const out = await adminResendWelcomeActivationEmail(id, req.adminAuth!.sub, req)
    res.json({ ok: true, ...out })
  })
)

adminRouter.get(
  '/tenants/:id/users',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const users = await adminListTenantUsers(id)
    res.json({ ok: true, items: users })
  })
)

adminRouter.get(
  '/tenants/:id/whatsapp-kredi',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const out = await adminGetTenantWhatsAppKredi(id)
    res.json(out)
  })
)

adminRouter.get(
  '/tenants/:id/whatsapp-kredi/hareketler',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25))
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const out = await adminListTenantWhatsAppKrediHareketler(id, { limit, offset })
    res.json(out)
  })
)

adminRouter.post(
  '/tenants/:id/whatsapp-kredi/adjust',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const body = adminWhatsAppKrediAdjustSchema.parse(req.body ?? {})
    const out = await adminAdjustTenantWhatsAppKredi({
      tenantId: id,
      adminId: req.adminAuth!.sub,
      req,
      yon: body.yon,
      miktar: body.miktar,
      aciklama: body.aciklama
    })
    res.json(out)
  })
)

adminRouter.get(
  '/whatsapp-mesaj-paket-talepleri',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const durumRaw = typeof req.query.durum === 'string' ? req.query.durum : undefined
    const durum =
      durumRaw &&
      Object.values(WhatsAppMesajPaketTalepDurum).includes(
        durumRaw as WhatsAppMesajPaketTalepDurum
      )
        ? (durumRaw as WhatsAppMesajPaketTalepDurum)
        : undefined
    const tenantId =
      typeof req.query.tenantId === 'string' && req.query.tenantId.trim()
        ? z.string().uuid().parse(req.query.tenantId)
        : undefined
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const out = await adminListPaketTalepleri({ durum, tenantId, limit, offset })
    res.json(out)
  })
)

adminRouter.post(
  '/whatsapp-mesaj-paket-talepleri/:id/onayla',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const body = adminWhatsAppPaketTalepResolveSchema.parse(req.body ?? {})
    const out = await adminOnaylaPaketTalebi({
      talepId: id,
      adminId: req.adminAuth!.sub,
      req,
      adminNotu: body.adminNotu
    })
    res.json(out)
  })
)

adminRouter.post(
  '/whatsapp-mesaj-paket-talepleri/:id/reddet',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const body = adminWhatsAppPaketTalepResolveSchema.parse(req.body ?? {})
    const out = await adminReddetPaketTalebi({
      talepId: id,
      adminId: req.adminAuth!.sub,
      req,
      adminNotu: body.adminNotu
    })
    res.json(out)
  })
)

adminRouter.put(
  '/users/:userId',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const userId = z.string().uuid().parse(req.params.userId)
    const body = adminUserUpdateBodySchema.parse(req.body)
    const updated = await adminUpdateUser(userId, body, req.adminAuth!.sub, req)
    res.json({ ok: true, user: updated })
  })
)

adminRouter.post(
  '/users/:userId/reset-password',
  requireAdminAuth,
  platformStaff,
  asyncHandler(async (req, res) => {
    const userId = z.string().uuid().parse(req.params.userId)
    const body = adminResetPasswordBodySchema.parse(req.body ?? {})
    const tenantId = z.string().uuid().parse(req.query.tenantId)
    const out = await adminResetUserPassword(userId, tenantId, body.yeniSifre, req.adminAuth!.sub, req)
    res.json({ ok: true, geciciSifre: out.geciciSifre })
  })
)

/**
 * Mevcut Meta WABA/Phone → tenant import (SUPER_ADMIN).
 * Zorunlu env: yalnızca WHATSAPP_WOONTEGRA_SYSTEM_USER_TOKEN.
 * WHATSAPP_CLOUD_TEST_PHONE gerekmez. Webhook override yok.
 * dryRun=true: yalnızca read-only Meta doğrulama; DB yazılmaz.
 */
adminRouter.post(
  '/whatsapp/import-existing-connection',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        tenantId: z.string().uuid(),
        wabaId: z.string().min(1).max(128),
        phoneNumberId: z.string().min(1).max(128),
        dryRun: z.boolean().optional(),
        accessToken: z.unknown().optional(),
        token: z.unknown().optional()
      })
      .strict()
      .parse(req.body ?? {})
    if (body.accessToken != null || body.token != null) {
      res.status(400).json({
        ok: false,
        code: 'TOKEN_NOT_ALLOWED',
        message: 'Access token body ile gönderilemez; yalnızca sunucu env kullanılır.'
      })
      return
    }
    const dryRun =
      body.dryRun === true ||
      String(req.query.dryRun ?? '').toLowerCase() === 'true'
    const baglanti = await importExistingMetaConnection(
      req.adminAuth!.sub,
      {
        tenantId: body.tenantId,
        wabaId: body.wabaId,
        phoneNumberId: body.phoneNumberId
      },
      req,
      { dryRun }
    )
    res.json({ ok: true, dryRun, baglanti })
  })
)

/**
 * İsteğe bağlı outbound Cloud API testi (SUPER_ADMIN).
 * Alıcı yalnızca WHATSAPP_CLOUD_TEST_PHONE (import/worker’a bağlı değil).
 * confirm=true zorunlu. Production gönderim müvekkil telefonundan yapılır.
 */
adminRouter.post(
  '/whatsapp/outbound-test',
  requireAdminAuth,
  superOnly,
  adminWhatsAppOutboundTestRateLimit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        tenantId: z.string().uuid(),
        confirm: z.literal(true),
        to: z.unknown().optional(),
        phone: z.unknown().optional()
      })
      .strict()
      .parse(req.body ?? {})
    if (body.to != null || body.phone != null) {
      res.status(400).json({
        ok: false,
        code: 'RECIPIENT_NOT_ALLOWED',
        message: 'Alıcı yalnızca WHATSAPP_CLOUD_TEST_PHONE env ile belirlenir.'
      })
      return
    }
    const out = await sendAdminOutboundCloudTest(
      req.adminAuth!.sub,
      { tenantId: body.tenantId, confirm: true },
      req
    )
    res.json(out)
  })
)

/**
 * Kontrollü tek session Cloud text testi (SUPER_ADMIN).
 * Woontegra import bağlantısı: tenantId → encrypted token + phoneNumberId.
 * Body `to` zorunlu; WHATSAPP_CLOUD_TEST_PHONE kullanılmaz.
 * Meta template yok; webhook override değiştirilmez. confirm=true zorunlu.
 */
adminRouter.post(
  '/whatsapp/controlled-session-test',
  requireAdminAuth,
  superOnly,
  adminWhatsAppOutboundTestRateLimit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        tenantId: z.string().uuid(),
        to: z.string().min(10).max(32),
        confirm: z.literal(true)
      })
      .strict()
      .parse(req.body ?? {})
    const out = await sendControlledSessionCloudTextTest(
      req.adminAuth!.sub,
      { tenantId: body.tenantId, to: body.to, confirm: true },
      req
    )
    res.json(out)
  })
)

/**
 * WABA-level webhook override durumu (SUPER_ADMIN).
 * WABA ID / callback body’den alınmaz — tenant bağlantısı + env.
 */
adminRouter.get(
  '/whatsapp/webhook-override',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const tenantId = z.string().uuid().parse(req.query.tenantId)
    const out = await getAdminWhatsAppWebhookOverrideStatus(tenantId)
    res.json(out)
  })
)

/**
 * Bu tenant WABA’sını MK webhook URL’sine yönlendir (SUPER_ADMIN).
 * Meta App global callback değiştirilmez. confirm=true zorunlu.
 */
adminRouter.post(
  '/whatsapp/webhook-override/enable',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        tenantId: z.string().uuid(),
        confirm: z.literal(true),
        wabaId: z.unknown().optional(),
        callbackUrl: z.unknown().optional(),
        override_callback_uri: z.unknown().optional()
      })
      .strict()
      .parse(req.body ?? {})
    if (body.wabaId != null || body.callbackUrl != null || body.override_callback_uri != null) {
      res.status(400).json({
        ok: false,
        code: 'OVERRIDE_PARAMS_NOT_ALLOWED',
        message: 'WABA ID ve callback URL istemciden kabul edilmez; sunucu kayıtları kullanılır.'
      })
      return
    }
    const out = await enableAdminWhatsAppWebhookOverride(req.adminAuth!.sub, body.tenantId, req)
    res.json(out)
  })
)

/**
 * WABA alternate callback kaldır (Meta: boş POST subscribed_apps).
 * App global callback’e dokunulmaz. confirm=true zorunlu.
 */
adminRouter.post(
  '/whatsapp/webhook-override/disable',
  requireAdminAuth,
  superOnly,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        tenantId: z.string().uuid(),
        confirm: z.literal(true),
        wabaId: z.unknown().optional(),
        callbackUrl: z.unknown().optional()
      })
      .strict()
      .parse(req.body ?? {})
    if (body.wabaId != null || body.callbackUrl != null) {
      res.status(400).json({
        ok: false,
        code: 'OVERRIDE_PARAMS_NOT_ALLOWED',
        message: 'WABA ID ve callback URL istemciden kabul edilmez; sunucu kayıtları kullanılır.'
      })
      return
    }
    const out = await disableAdminWhatsAppWebhookOverride(req.adminAuth!.sub, body.tenantId, req)
    res.json(out)
  })
)
