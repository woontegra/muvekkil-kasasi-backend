import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { loadAuthContext } from '../middleware/loadAuthContext.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { AppError } from '../middleware/errorHandler.js'
import { buildTenantLicenseCurrent } from './license.service.js'
import { issueLicensePurchaseLink, issueLicenseRenewalLink } from '../integrations/woontegraWebsite/licensePurchase.service.js'

export const licenseRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

licenseRouter.get(
  '/current',
  requireAuth,
  loadAuthContext,
  asyncHandler(async (req, res) => {
    const tenant = req.tenant!
    const payload = buildTenantLicenseCurrent(tenant, req.auth!.role)
    res.json({ ok: true, ...payload })
  })
)

licenseRouter.post(
  '/purchase-link',
  requireAuth,
  loadAuthContext,
  asyncHandler(async (req, res) => {
    if (req.auth!.role !== 'BURO_SAHIBI' && req.auth!.role !== 'AVUKAT_YONETICI') {
      throw new AppError(403, 'Lisans satın alma bağlantısı yalnızca büro yöneticileri için.', 'FORBIDDEN')
    }
    const meta = getRequestMeta(req)
    const result = await issueLicensePurchaseLink({
      userId: req.auth!.sub,
      tenantId: req.auth!.tenantId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    res.status(200).json({ ok: true, ...result })
  })
)

licenseRouter.post(
  '/renewal-link',
  requireAuth,
  loadAuthContext,
  asyncHandler(async (req, res) => {
    if (req.auth!.role !== 'BURO_SAHIBI' && req.auth!.role !== 'AVUKAT_YONETICI') {
      throw new AppError(403, 'Lisans yenileme bağlantısı yalnızca büro yöneticileri için.', 'FORBIDDEN')
    }
    const meta = getRequestMeta(req)
    const result = await issueLicenseRenewalLink({
      userId: req.auth!.sub,
      tenantId: req.auth!.tenantId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    res.status(200).json({ ok: true, ...result })
  })
)
