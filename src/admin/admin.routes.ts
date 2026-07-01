import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { z } from 'zod'
import { serializeTenant } from '../auth/auth.service.js'
import { requireAdminAuth } from '../middleware/requireAdminAuth.js'
import { requireAdminRoles } from '../middleware/requireAdminRoles.js'
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
  adminUserUpdateBodySchema
} from './admin.schemas.js'
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

const allAdmin = requireAdminRoles('SUPER_ADMIN', 'DESTEK', 'FINANS')
const financeOrSuper = requireAdminRoles('SUPER_ADMIN', 'FINANS')
const superOnly = requireAdminRoles('SUPER_ADMIN')
const supportOrSuper = requireAdminRoles('SUPER_ADMIN', 'DESTEK')

adminRouter.get(
  '/settings/profile',
  requireAdminAuth,
  allAdmin,
  asyncHandler(async (req, res) => {
    const profile = await adminGetSettingsProfile(req.adminAuth!.sub)
    res.json({ ok: true, profile })
  })
)

adminRouter.put(
  '/settings/profile',
  requireAdminAuth,
  allAdmin,
  asyncHandler(async (req, res) => {
    const body = adminProfileUpdateSchema.parse(req.body)
    const profile = await adminUpdateSettingsProfile(req.adminAuth!.sub, body, req)
    res.json({ ok: true, profile })
  })
)

adminRouter.post(
  '/settings/change-password',
  requireAdminAuth,
  allAdmin,
  asyncHandler(async (req, res) => {
    const body = adminSelfChangePasswordSchema.parse(req.body)
    await adminChangeOwnPassword(req.adminAuth!.sub, body, req)
    res.json({ ok: true })
  })
)

adminRouter.get(
  '/settings/system-info',
  requireAdminAuth,
  allAdmin,
  asyncHandler(async (req, res) => {
    res.json({ ok: true, ...adminGetSystemInfo(req) })
  })
)

adminRouter.get(
  '/admin-users',
  requireAdminAuth,
  allAdmin,
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
  allAdmin,
  asyncHandler(async (_req, res) => {
    const stats = await getAdminDashboardStats()
    res.json({ ok: true, ...stats })
  })
)

adminRouter.get(
  '/tenants/expiring',
  requireAdminAuth,
  allAdmin,
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 7))
    const items = await adminListExpiringTenants(days)
    res.json({ ok: true, items, days })
  })
)

adminRouter.get(
  '/tenants',
  requireAdminAuth,
  allAdmin,
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
  allAdmin,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const out = await adminGetTenant(id)
    res.json({ ok: true, ...out })
  })
)

adminRouter.put(
  '/tenants/:id',
  requireAdminAuth,
  allAdmin,
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

adminRouter.post(
  '/tenants/:id/resend-welcome-mail',
  requireAdminAuth,
  supportOrSuper,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const out = await adminResendWelcomeActivationEmail(id, req.adminAuth!.sub, req)
    res.json({ ok: true, ...out })
  })
)

adminRouter.get(
  '/tenants/:id/users',
  requireAdminAuth,
  allAdmin,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id)
    const users = await adminListTenantUsers(id)
    res.json({ ok: true, items: users })
  })
)

adminRouter.put(
  '/users/:userId',
  requireAdminAuth,
  supportOrSuper,
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
  supportOrSuper,
  asyncHandler(async (req, res) => {
    const userId = z.string().uuid().parse(req.params.userId)
    const body = adminResetPasswordBodySchema.parse(req.body ?? {})
    const tenantId = z.string().uuid().parse(req.query.tenantId)
    const out = await adminResetUserPassword(userId, tenantId, body.yeniSifre, req.adminAuth!.sub, req)
    res.json({ ok: true, geciciSifre: out.geciciSifre })
  })
)
