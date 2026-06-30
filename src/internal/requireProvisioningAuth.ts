import { timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import { env } from '../config/env.js'
import { AppError } from '../middleware/errorHandler.js'

function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function readHeaderApiKey(req: { header: (name: string) => string | undefined }): string | undefined {
  const fromHeader = req.header('x-internal-api-key')?.trim()
  if (fromHeader) return fromHeader
  return undefined
}

/**
 * Merkezi lisans / website M2M provisioning kimlik doğrulaması.
 * Admin JWT kullanılmaz; yalnızca x-internal-api-key.
 */
export const requireProvisioningAuth: RequestHandler = (req, _res, next) => {
  const configured = env.PROVISIONING_API_KEY?.trim()
  if (!configured) {
    console.error('[internal] PROVISIONING_API_KEY tanımlı değil — provisioning reddedildi')
    return next(new AppError(503, 'Provisioning servisi yapılandırılmamış.', 'PROVISIONING_NOT_CONFIGURED'))
  }

  const provided = readHeaderApiKey(req)
  if (!provided) {
    return next(new AppError(401, 'Geçersiz veya eksik internal API anahtarı.', 'PROVISIONING_UNAUTHORIZED'))
  }

  if (!safeEqualString(provided, configured)) {
    return next(new AppError(401, 'Geçersiz veya eksik internal API anahtarı.', 'PROVISIONING_UNAUTHORIZED'))
  }

  const idempotencyKey = req.header('x-idempotency-key')?.trim()
  if (idempotencyKey) {
    req.provisioningIdempotencyKey = idempotencyKey
  }

  next()
}

declare global {
  namespace Express {
    interface Request {
      provisioningIdempotencyKey?: string
    }
  }
}

export {}