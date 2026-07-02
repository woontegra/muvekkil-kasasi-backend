import bcrypt from 'bcrypt'
import type { Tenant, User } from '@prisma/client'
import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'
import { saasLicenseKeysMatch } from '../lib/saasLicenseKey.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import { getRequestMeta } from './requestMeta.js'
import type { ActivateLicenseBody, ChangeInitialPasswordBody } from './auth.schemas.js'

const BCRYPT_ROUNDS = 12

export type UserOnboardingFlags = {
  requiresLicenseActivation: boolean
  mustChangePassword: boolean
}

/** Büro sahibi ilk giriş lisans doğrulaması gerekli mi? */
export function getUserOnboardingFlags(user: User, tenant: Tenant): UserOnboardingFlags {
  const hasLicenseKey = Boolean(tenant.lisansAnahtari?.trim())
  const requiresLicenseActivation =
    user.role === 'BURO_SAHIBI' && hasLicenseKey && user.licenseActivatedAt == null
  return {
    requiresLicenseActivation,
    mustChangePassword: user.mustChangePassword === true
  }
}

export async function activateLicenseForUser(
  user: User & { tenant: Tenant },
  body: ActivateLicenseBody,
  req: Request
): Promise<UserOnboardingFlags> {
  if (user.role !== 'BURO_SAHIBI') {
    throw new AppError(403, 'Lisans aktivasyonu yalnızca büro sahibi tarafından yapılabilir.', 'FORBIDDEN')
  }

  const tenantKey = user.tenant.lisansAnahtari?.trim()
  if (!tenantKey) {
    throw new AppError(422, 'Bu büro için lisans anahtarı tanımlı değil.', 'LICENSE_NOT_CONFIGURED')
  }

  if (user.licenseActivatedAt) {
    return getUserOnboardingFlags(user, user.tenant)
  }

  const inputKey = body.licenseKey.trim()
  if (!inputKey) {
    throw new AppError(422, 'Lisans anahtarı zorunludur.', 'VALIDATION_ERROR')
  }

  if (!saasLicenseKeysMatch(inputKey, tenantKey)) {
    const meta = getRequestMeta(req)
    await writeAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'LICENSE_ACTIVATION_FAILED',
      entityType: 'Tenant',
      entityId: user.tenantId,
      meta: { reason: 'MISMATCH' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(
      400,
      'Lisans anahtarı hatalı. Lütfen size gönderilen lisans anahtarını kontrol edin.',
      'INVALID_LICENSE_KEY'
    )
  }

  const meta = getRequestMeta(req)
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { licenseActivatedAt: new Date() },
    include: { tenant: true }
  })

  await writeAuditLog({
    tenantId: updated.tenantId,
    userId: updated.id,
    action: 'LICENSE_ACTIVATED',
    entityType: 'Tenant',
    entityId: updated.tenantId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getUserOnboardingFlags(updated, updated.tenant)
}

export async function changeInitialPasswordForUser(
  user: User & { tenant: Tenant },
  body: ChangeInitialPasswordBody,
  req: Request
): Promise<UserOnboardingFlags> {
  if (!user.mustChangePassword) {
    throw new AppError(400, 'Bu hesap için zorunlu şifre değişimi beklenmiyor.', 'PASSWORD_CHANGE_NOT_REQUIRED')
  }

  const onboarding = getUserOnboardingFlags(user, user.tenant)
  if (onboarding.requiresLicenseActivation) {
    throw new AppError(403, 'Önce lisans anahtarınızı doğrulayın.', 'LICENSE_ACTIVATION_REQUIRED')
  }

  const sifreHash = await bcrypt.hash(body.yeniSifre, BCRYPT_ROUNDS)
  const meta = getRequestMeta(req)

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      sifreHash,
      mustChangePassword: false
    },
    include: { tenant: true }
  })

  await writeAuditLog({
    tenantId: updated.tenantId,
    userId: updated.id,
    action: 'INITIAL_PASSWORD_CHANGED',
    entityType: 'User',
    entityId: updated.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getUserOnboardingFlags(updated, updated.tenant)
}
