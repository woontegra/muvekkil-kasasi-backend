import jwt, { type Secret, type SignOptions } from 'jsonwebtoken'
import type { SuperAdminRole } from '@prisma/client'
import { env, adminJwtSecretResolved } from '../config/env.js'
import type { AdminJwtPayload } from '../types/adminPayload.js'

export const ADMIN_JWT_ISS = 'muvekkil-kasa-defteri-admin'
export const ADMIN_JWT_AUD = 'admin-api'

export function adminJwtSecret(): string {
  return adminJwtSecretResolved()
}

export function signAdminAccessToken(input: { adminId: string; role: SuperAdminRole; kullaniciAdi: string }): string {
  const payload: AdminJwtPayload = {
    typ: 'admin',
    sub: input.adminId,
    role: input.role,
    kullaniciAdi: input.kullaniciAdi
  }
  const secret: Secret = adminJwtSecret()
  const options = {
    algorithm: 'HS256' as const,
    expiresIn: env.ADMIN_JWT_EXPIRES_IN,
    issuer: ADMIN_JWT_ISS,
    audience: ADMIN_JWT_AUD
  } as SignOptions
  return jwt.sign(payload, secret, options)
}

export function verifyAdminAccessToken(token: string): AdminJwtPayload {
  let decoded: AdminJwtPayload
  try {
    decoded = jwt.verify(token, adminJwtSecret(), {
      algorithms: ['HS256'],
      issuer: ADMIN_JWT_ISS,
      audience: ADMIN_JWT_AUD
    }) as AdminJwtPayload
  } catch {
    // Eski kısa ömürlü admin tokenlar (iss/aud yok) süreleri dolana kadar
    decoded = jwt.verify(token, adminJwtSecret(), { algorithms: ['HS256'] }) as AdminJwtPayload
  }
  if (decoded.typ !== 'admin') {
    throw new Error('INVALID_ADMIN_TOKEN')
  }
  if (!decoded.sub || !decoded.role || !decoded.kullaniciAdi) {
    throw new Error('INVALID_ADMIN_TOKEN')
  }
  return decoded
}
