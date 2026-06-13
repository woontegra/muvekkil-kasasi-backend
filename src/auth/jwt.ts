import jwt, { type Secret, type SignOptions } from 'jsonwebtoken'
import type { UserRole } from '@prisma/client'
import { env } from '../config/env.js'
import type { AuthUserPayload } from '../types/authPayload.js'

export function signAccessToken(input: {
  userId: string
  tenantId: string
  role: UserRole
  kullaniciAdi: string
}): string {
  const payload: AuthUserPayload = {
    sub: input.userId,
    tenantId: input.tenantId,
    role: input.role,
    kullaniciAdi: input.kullaniciAdi
  }
  const secret: Secret = env.JWT_SECRET
  const options = { expiresIn: env.JWT_EXPIRES_IN } as SignOptions
  return jwt.sign(payload, secret, options)
}
