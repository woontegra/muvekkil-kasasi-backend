import bcrypt from 'bcrypt'
import type { Tenant, User } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { normalizeLoginIdentifier } from '../lib/normalizeKullaniciAdi.js'
import { writeAuditLog } from '../audit/auditService.js'
import { signAccessToken } from './jwt.js'
import type { LoginBody } from './auth.schemas.js'
import { AppError } from '../middleware/errorHandler.js'
import type { Request } from 'express'
import { getRequestMeta } from './requestMeta.js'
import { assertTenantLoginAllowed } from '../tenant/tenantLicense.js'
import { getUserOnboardingFlags } from './authOnboarding.service.js'

const BCRYPT_ROUNDS = 12

export type PublicUser = Omit<User, 'sifreHash'>
export type PublicTenant = Omit<Tenant, 'yillikUcret' | 'lisansAnahtari'> & { yillikUcret: string | null }

export function serializeUser(u: User & { tenant?: Tenant }): PublicUser {
  const { sifreHash: _, tenant: __, ...rest } = u
  return rest as PublicUser
}

export function serializeTenant(t: Tenant): PublicTenant {
  const { yillikUcret, lisansAnahtari: _, ...rest } = t
  return {
    ...rest,
    yillikUcret: yillikUcret == null ? null : yillikUcret.toFixed(2)
  }
}

export type AuthOnboardingPayload = {
  requiresLicenseActivation: boolean
  mustChangePassword: boolean
}

export type AuthSuccessPayload = AuthOnboardingPayload & {
  accessToken: string
  user: PublicUser
  tenant: PublicTenant
}

export async function login(body: LoginBody, req: Request): Promise<AuthSuccessPayload> {
  const meta = getRequestMeta(req)
  const raw = body.identifier.trim()
  const isEmail = raw.includes('@')
  const identifier = isEmail ? raw.toLowerCase() : normalizeLoginIdentifier(raw)

  let user: (User & { tenant: Tenant }) | null = null

  if (isEmail) {
    const email = raw.toLowerCase()
    const matches = await prisma.user.findMany({
      where: {
        eposta: { equals: email, mode: 'insensitive' },
        aktifMi: true
      },
      include: { tenant: true }
    })
    if (matches.length === 0) {
      await writeAuditLog({
        tenantId: null,
        userId: null,
        action: 'AUTH_LOGIN_FAILED',
        meta: { reason: 'USER_NOT_FOUND', identifier: email },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      })
      throw new AppError(401, 'E-posta/kullanıcı adı veya şifre hatalı.', 'INVALID_CREDENTIALS')
    }
    if (matches.length > 1) {
      await writeAuditLog({
        tenantId: null,
        userId: null,
        action: 'AUTH_LOGIN_FAILED',
        meta: { reason: 'AMBIGUOUS_EMAIL', identifier: email },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      })
      throw new AppError(
        400,
        'Bu e-posta birden fazla büroda kayıtlı. Lütfen kullanıcı adınızla giriş yapın.',
        'AMBIGUOUS_EMAIL'
      )
    }
    user = matches[0]!
  } else {
    user = await prisma.user.findFirst({
      where: {
        kullaniciAdi: { equals: identifier, mode: 'insensitive' },
        aktifMi: true
      },
      include: { tenant: true }
    })
    if (!user) {
      await writeAuditLog({
        tenantId: null,
        userId: null,
        action: 'AUTH_LOGIN_FAILED',
        meta: { reason: 'USER_NOT_FOUND', kullaniciAdi: identifier },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      })
      throw new AppError(401, 'E-posta/kullanıcı adı veya şifre hatalı.', 'INVALID_CREDENTIALS')
    }
  }

  const ok = await bcrypt.compare(body.sifre, user.sifreHash)
  if (!ok) {
    await writeAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'AUTH_LOGIN_FAILED',
      meta: { reason: 'BAD_PASSWORD' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(401, 'E-posta/kullanıcı adı veya şifre hatalı.', 'INVALID_CREDENTIALS')
  }

  assertTenantLoginAllowed(user.tenant)

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { sonGirisTarihi: new Date() },
    include: { tenant: true }
  })

  await writeAuditLog({
    tenantId: updated.tenantId,
    userId: updated.id,
    action: 'AUTH_LOGIN_SUCCESS',
    entityType: 'User',
    entityId: updated.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  const accessToken = signAccessToken({
    userId: updated.id,
    tenantId: updated.tenant.id,
    role: updated.role,
    kullaniciAdi: updated.kullaniciAdi
  })

  const onboarding = getUserOnboardingFlags(updated, updated.tenant)

  return {
    accessToken,
    user: serializeUser(updated),
    tenant: serializeTenant(updated.tenant),
    requiresLicenseActivation: onboarding.requiresLicenseActivation,
    mustChangePassword: onboarding.mustChangePassword
  }
}

export async function loadUserWithTenant(userId: string, tenantId: string): Promise<(User & { tenant: Tenant }) | null> {
  return prisma.user.findFirst({
    where: { id: userId, tenantId, aktifMi: true, tenant: { aktifMi: true } },
    include: { tenant: true }
  })
}
