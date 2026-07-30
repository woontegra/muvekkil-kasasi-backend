import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { signAccessToken } from './jwt.js'
import { serializeTenant, serializeUser, type AuthSuccessPayload } from './auth.service.js'
import { getUserOnboardingFlags } from './authOnboarding.service.js'
import { assertTenantLoginAllowed } from '../tenant/tenantLicense.js'
import { refreshMaxAgeMs, TENANT_REFRESH_COOKIE } from './sessionCookies.js'

export function hashOpaqueToken(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex')
}

function generateOpaqueToken(): string {
  return randomBytes(48).toString('base64url')
}

export async function createRefreshSession(input: {
  tenantId: string
  userId: string
  familyId?: string
  label?: string | null
}): Promise<{ plainToken: string; familyId: string }> {
  const plainToken = generateOpaqueToken()
  const familyId = input.familyId ?? randomUUID()
  const now = new Date()
  await prisma.refreshSession.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      tokenHash: hashOpaqueToken(plainToken),
      familyId,
      expiresAt: new Date(now.getTime() + refreshMaxAgeMs()),
      lastUsedAt: now,
      label: input.label?.slice(0, 64) ?? 'web'
    }
  })
  return { plainToken, familyId }
}

export async function revokeUserRefreshSessions(userId: string): Promise<number> {
  const r = await prisma.refreshSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() }
  })
  return r.count
}

export async function revokeTenantRefreshSessions(tenantId: string): Promise<number> {
  const r = await prisma.refreshSession.updateMany({
    where: { tenantId, revokedAt: null },
    data: { revokedAt: new Date() }
  })
  return r.count
}

export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshSession.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() }
  })
}

export async function rotateRefreshSession(
  plainToken: string
): Promise<AuthSuccessPayload & { refreshPlain: string }> {
  const tokenHash = hashOpaqueToken(plainToken)
  const now = new Date()

  const existing = await prisma.refreshSession.findUnique({
    where: { tokenHash },
    include: { user: { include: { tenant: true } } }
  })

  if (!existing) {
    throw new AppError(401, 'Oturum yenilenemedi. Lütfen tekrar giriş yapın.', 'REFRESH_INVALID')
  }

  if (existing.revokedAt != null) {
    await revokeFamily(existing.familyId)
    throw new AppError(401, 'Oturum güvenliği nedeniyle sonlandırıldı. Lütfen tekrar giriş yapın.', 'REFRESH_REUSE')
  }

  if (existing.expiresAt.getTime() <= now.getTime()) {
    await prisma.refreshSession.update({
      where: { id: existing.id },
      data: { revokedAt: now }
    })
    throw new AppError(401, 'Oturum süresi doldu. Lütfen tekrar giriş yapın.', 'REFRESH_EXPIRED')
  }

  const user = existing.user
  if (!user.aktifMi || !user.tenant.aktifMi) {
    await revokeFamily(existing.familyId)
    throw new AppError(401, 'Hesap veya büro pasif.', 'REFRESH_INACTIVE')
  }

  try {
    assertTenantLoginAllowed(user.tenant)
  } catch {
    await revokeFamily(existing.familyId)
    throw new AppError(401, 'Büro lisansı oturumu engelliyor.', 'REFRESH_LICENSE')
  }

  const claimed = await prisma.refreshSession.updateMany({
    where: { id: existing.id, revokedAt: null, tokenHash },
    data: { revokedAt: now, lastUsedAt: now }
  })
  if (claimed.count !== 1) {
    await revokeFamily(existing.familyId)
    throw new AppError(401, 'Oturum güvenliği nedeniyle sonlandırıldı. Lütfen tekrar giriş yapın.', 'REFRESH_REUSE')
  }

  const { plainToken: refreshPlain } = await createRefreshSession({
    tenantId: user.tenantId,
    userId: user.id,
    familyId: existing.familyId,
    label: existing.label
  })

  const accessToken = signAccessToken({
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    kullaniciAdi: user.kullaniciAdi
  })
  const onboarding = getUserOnboardingFlags(user, user.tenant)

  return {
    accessToken,
    refreshPlain,
    user: serializeUser(user),
    tenant: serializeTenant(user.tenant),
    requiresLicenseActivation: onboarding.requiresLicenseActivation,
    mustChangePassword: onboarding.mustChangePassword
  }
}

export async function revokeCurrentRefreshFromCookie(req: Request): Promise<string | null> {
  const plain = req.cookies?.[TENANT_REFRESH_COOKIE]
  if (typeof plain !== 'string' || !plain) return null
  const hash = hashOpaqueToken(plain)
  const row = await prisma.refreshSession.findFirst({
    where: { tokenHash: hash, revokedAt: null },
    select: { userId: true }
  })
  await prisma.refreshSession.updateMany({
    where: { tokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date() }
  })
  return row?.userId ?? null
}
