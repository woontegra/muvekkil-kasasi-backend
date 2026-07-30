import jwt, { type Secret, type SignOptions } from 'jsonwebtoken'
import type { UserRole } from '@prisma/client'
import { env } from '../config/env.js'
import type { AuthUserPayload } from '../types/authPayload.js'

export const TENANT_JWT_ISS = 'muvekkil-kasa-defteri'
export const TENANT_JWT_AUD = 'tenant-api'

const SIGN_OPTS_BASE = { algorithm: 'HS256' as const }

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
    kullaniciAdi: input.kullaniciAdi,
    typ: 'tenant'
  }
  const secret: Secret = env.JWT_SECRET
  const options = {
    ...SIGN_OPTS_BASE,
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: TENANT_JWT_ISS,
    audience: TENANT_JWT_AUD
  } as SignOptions
  return jwt.sign(payload, secret, options)
}

export function verifyTenantAccessToken(token: string): AuthUserPayload {
  const raw = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: TENANT_JWT_ISS,
    audience: TENANT_JWT_AUD
  }) as Record<string, unknown>
  if (raw.typ !== 'tenant') {
    throw new Error('INVALID_TENANT_TOKEN')
  }
  const tenantId = raw.tenantId as string | undefined
  const sub = raw.sub as string | undefined
  const role = raw.role as AuthUserPayload['role'] | undefined
  const kullaniciAdi = raw.kullaniciAdi as string | undefined
  if (!tenantId || !sub || !role || !kullaniciAdi) {
    throw new Error('INVALID_TENANT_TOKEN')
  }
  return { sub, tenantId, role, kullaniciAdi, typ: 'tenant' }
}
