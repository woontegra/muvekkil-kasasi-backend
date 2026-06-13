import type { RequestHandler } from 'express'
import { serializeTenant, serializeUser } from '../auth/auth.service.js'

export const meHandler: RequestHandler = (req, res) => {
  const u = req.user!
  res.json({
    ok: true,
    user: serializeUser(u),
    tenant: serializeTenant(u.tenant)
  })
}
