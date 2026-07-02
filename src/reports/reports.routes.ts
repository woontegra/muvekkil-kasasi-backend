import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { buildOfisKasaReport } from './ofisKasaReport.service.js'
import { buildIcraTahsilatReport } from './icraTahsilatReport.service.js'
import { icraTahsilatReportQuerySchema, ofisKasaReportQuerySchema } from './reports.schemas.js'

export const reportsRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

reportsRouter.get(
  '/ofis-kasa',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const query = ofisKasaReportQuerySchema.parse(req.query)
    const report = await buildOfisKasaReport(tenantId, query)
    res.json({ ok: true, ...report })
  })
)

reportsRouter.get(
  '/icra-tahsilat',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const query = icraTahsilatReportQuerySchema.parse(req.query)
    const report = await buildIcraTahsilatReport(tenantId, query)
    res.json({ ok: true, ...report })
  })
)
