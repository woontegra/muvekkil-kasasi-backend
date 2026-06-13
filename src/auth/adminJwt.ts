import jwt, { type Secret, type SignOptions } from 'jsonwebtoken'
import type { SuperAdminRole } from '@prisma/client'
import { env } from '../config/env.js'
import type { AdminJwtPayload } from '../types/adminPayload.js'

export function adminJwtSecret(): string {
  return env.ADMIN_JWT_SECRET ?? env.JWT_SECRET
}

export function signAdminAccessToken(input: { adminId: string; role: SuperAdminRole; kullaniciAdi: string }): string {
  const payload: AdminJwtPayload = {
    typ: 'admin',
    sub: input.adminId,
    role: input.role,
    kullaniciAdi: input.kullaniciAdi
  }
  const secret: Secret = adminJwtSecret()
  const options = { expiresIn: env.ADMIN_JWT_EXPIRES_IN } as SignOptions
  return jwt.sign(payload, secret, options)
}

export function verifyAdminAccessToken(token: string): AdminJwtPayload {
  const decoded = jwt.verify(token, adminJwtSecret()) as AdminJwtPayload
  if (decoded.typ !== 'admin') {
    throw new Error('INVALID_ADMIN_TOKEN')
  }
  return decoded
}
