import type { RequestHandler } from 'express'
import helmet from 'helmet'

/**
 * Temel güvenlik başlıkları.
 * CSP bilinçli olarak rapor-dostu / API odaklı; frontend ayrı origin’de servis edilir.
 */
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false,
  noSniff: true,
  referrerPolicy: { policy: 'no-referrer' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' }
})
