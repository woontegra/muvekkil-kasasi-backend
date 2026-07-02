import type { RequestHandler } from 'express'
import { serializeTenant, serializeUser } from '../auth/auth.service.js'
import { getUserOnboardingFlags } from '../auth/authOnboarding.service.js'

export const meHandler: RequestHandler = (req, res) => {
  const u = req.user!
  const onboarding = getUserOnboardingFlags(u, u.tenant)
  res.json({
    ok: true,
    user: serializeUser(u),
    tenant: serializeTenant(u.tenant),
    requiresLicenseActivation: onboarding.requiresLicenseActivation,
    mustChangePassword: onboarding.mustChangePassword
  })
}
