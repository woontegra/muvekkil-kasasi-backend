import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { requireWoontegraWebsiteProvisionAuth } from './requireWoontegraWebsiteProvisionAuth.js'
import { parseWoontegraWebsiteProvisionBody } from './woontegraWebsiteProvision.schemas.js'
import { provisionTenantFromWoontegraWebsite } from './woontegraWebsiteProvision.service.js'
import { parseWoontegraWebsiteRenewBody } from './woontegraWebsiteRenew.schemas.js'
import { renewTenantFromWoontegraWebsite } from './woontegraWebsiteRenew.service.js'

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

woontegraWebsiteProvisionRouter.post(
  '/tenants/renew',
  requireWoontegraWebsiteProvisionAuth,
  asyncHandler(async (req, res) => {
    const body = parseWoontegraWebsiteRenewBody(req.body)
    const result = await renewTenantFromWoontegraWebsite(body, req)
    res.status(200).json(result)
  })
)
