import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { requireWoontegraWebsiteProvisionAuth } from './requireWoontegraWebsiteProvisionAuth.js'
import { parseWoontegraWebsiteProvisionBody } from './woontegraWebsiteProvision.schemas.js'
import { provisionTenantFromWoontegraWebsite } from './woontegraWebsiteProvision.service.js'
import { parseWoontegraWebsiteRenewBody } from './woontegraWebsiteRenew.schemas.js'
import { renewTenantFromWoontegraWebsite } from './woontegraWebsiteRenew.service.js'
import { lookupTenantsByOwnerEmail } from './woontegraWebsiteLookup.service.js'
import {
  bindLicensePurchaseToken,
  fulfillLicensePurchase,
  previewLicenseRenewalEnd,
  resolveLicensePurchaseToken
} from './licensePurchase.service.js'
import {
  parseLicensePurchaseBindBody,
  parseLicensePurchaseFulfillBody,
  parseLicensePurchasePreviewBody,
  parseLicensePurchaseResolveBody
} from './licensePurchase.schemas.js'

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

export const woontegraWebsiteProvisionRouter = Router()

woontegraWebsiteProvisionRouter.post(
  '/tenants/provision',
  requireWoontegraWebsiteProvisionAuth,
  asyncHandler(async (req, res) => {
    const body = parseWoontegraWebsiteProvisionBody(req.body)
    const result = await provisionTenantFromWoontegraWebsite(body, req)
    const status = result.status === 'created' ? 201 : 200
    res.status(status).json(result)
  })
)

woontegraWebsiteProvisionRouter.get(
  '/tenants/lookup-by-email',
  requireWoontegraWebsiteProvisionAuth,
  asyncHandler(async (req, res) => {
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : ''
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ ok: false, message: 'Geçerli e-posta gerekli.' })
      return
    }
    const result = await lookupTenantsByOwnerEmail(email)
    res.status(200).json(result)
  }),
)

woontegraWebsiteProvisionRouter.post(
  '/tenants/renew',
  requireWoontegraWebsiteProvisionAuth,
  asyncHandler(async (req, res) => {
    const body = parseWoontegraWebsiteRenewBody(req.body)
    const result = await renewTenantFromWoontegraWebsite(body, req)
    res.status(200).json(result)
  })
)

woontegraWebsiteProvisionRouter.post(
  '/license-purchase/resolve',
  requireWoontegraWebsiteProvisionAuth,
  asyncHandler(async (req, res) => {
    const body = parseLicensePurchaseResolveBody(req.body)
    const result = await resolveLicensePurchaseToken(body.renewalToken)
    res.status(200).json({ ok: true, ...result })
  })
)

woontegraWebsiteProvisionRouter.post(
  '/license-purchase/bind',
  requireWoontegraWebsiteProvisionAuth,
  asyncHandler(async (req, res) => {
    const body = parseLicensePurchaseBindBody(req.body)
    const result = await bindLicensePurchaseToken(body)
    res.status(200).json({ ok: true, ...result })
  })
)

woontegraWebsiteProvisionRouter.post(
  '/license-purchase/preview',
  requireWoontegraWebsiteProvisionAuth,
  asyncHandler(async (req, res) => {
    const body = parseLicensePurchasePreviewBody(req.body)
    const result = await previewLicenseRenewalEnd(body)
    res.status(200).json({ ok: true, ...result })
  })
)

woontegraWebsiteProvisionRouter.post(
  '/license-purchase/fulfill',
  requireWoontegraWebsiteProvisionAuth,
  asyncHandler(async (req, res) => {
    const body = parseLicensePurchaseFulfillBody(req.body)
    const result = await fulfillLicensePurchase(body)
    res.status(200).json(result)
  })
)
