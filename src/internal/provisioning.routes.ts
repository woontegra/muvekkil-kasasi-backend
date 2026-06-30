import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { requireProvisioningAuth } from './requireProvisioningAuth.js'
import { parseProvisionTenantBody } from './provisioning.schemas.js'
import { provisionTenantFromCentralLicense } from './provisioning.service.js'

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

export const provisioningRouter = Router()

provisioningRouter.post(
  '/tenants/provision',
  requireProvisioningAuth,
  asyncHandler(async (req, res) => {
    const body = parseProvisionTenantBody(req.body)
    const result = await provisionTenantFromCentralLicense(body, req)
    res.status(result.idempotentReplay ? 200 : 201).json(result)
  })
)
