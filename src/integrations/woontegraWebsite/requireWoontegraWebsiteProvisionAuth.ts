import { timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import { env } from '../../config/env.js'
import { AppError } from '../../middleware/errorHandler.js'

function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

const HEADER_NAME = 'x-woontegra-website-provision-secret'

/**
 * Woontegra Website server-to-server tenant oluşturma isteği doğrulaması.
 */
export const requireWoontegraWebsiteProvisionAuth: RequestHandler = (req, _res, next) => {
  const configured = env.WOONTEGRA_WEBSITE_PROVISION_SECRET?.trim()
  if (!configured) {
    if (env.NODE_ENV === 'production') {
      console.error('[woontegra-website] WOONTEGRA_WEBSITE_PROVISION_SECRET tanımlı değil')
      return next(
        new AppError(
          503,
          'Woontegra Website entegrasyonu yapılandırılmamış.',
          'WOONTEGRA_WEBSITE_PROVISION_NOT_CONFIGURED'
        )
      )
    }
    return next(
      new AppError(
        503,
        'Woontegra Website entegrasyonu yapılandırılmamış (WOONTEGRA_WEBSITE_PROVISION_SECRET).',
        'WOONTEGRA_WEBSITE_PROVISION_NOT_CONFIGURED'
      )
    )
  }

  const provided = req.header(HEADER_NAME)?.trim()
  if (!provided) {
    return next(
      new AppError(401, 'Eksik entegrasyon secret başlığı.', 'WOONTEGRA_WEBSITE_PROVISION_UNAUTHORIZED')
    )
  }

  if (!safeEqualString(provided, configured)) {
    return next(
      new AppError(403, 'Geçersiz entegrasyon secret.', 'WOONTEGRA_WEBSITE_PROVISION_FORBIDDEN')
    )
  }

  next()
}
