import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcrypt'
import type { Request } from 'express'
import type { User, Tenant } from '@prisma/client'
import { writeAuditLog } from '../audit/auditService.js'
import { prisma } from '../lib/prisma.js'
import { normalizeLoginIdentifier } from '../lib/normalizeKullaniciAdi.js'
import { AppError } from '../middleware/errorHandler.js'
import { sendPasswordResetEmail } from '../mail/mail.service.js'
import type { ForgotPasswordBody, ResetPasswordBody } from './auth.schemas.js'
import { getRequestMeta } from './requestMeta.js'
import { getActivationTokenExpiresHours } from '../config/env.js'

export const FORGOT_PASSWORD_PUBLIC_MESSAGE =
  'Bilgiler sistemde kayıtlıysa şifre sıfırlama bağlantısı gönderilecektir.'

const BCRYPT_ROUNDS = 12
const RESET_TOKEN_EXPIRES_MIN = 30

const GENERIC_RESET_FAILURE =
  'Geçersiz veya süresi dolmuş sıfırlama bağlantısı. Lütfen yeni bir talep oluşturun.'

export function hashResetToken(plainToken: string): string {
  return createHash('sha256').update(plainToken.trim(), 'utf8').digest('hex')
}

function generatePlainResetToken(): string {
  return randomBytes(32).toString('base64url')
}

type UserWithTenant = User & { tenant: Tenant }

async function findUserForPasswordReset(identifier: string): Promise<UserWithTenant | null> {
  const raw = identifier.trim()
  if (!raw) return null

  if (raw.includes('@')) {
    const email = raw.toLowerCase()
    const users = await prisma.user.findMany({
      where: {
        eposta: { equals: email, mode: 'insensitive' },
        aktifMi: true,
        tenant: { aktifMi: true }
      },
      include: { tenant: true }
    })
    if (users.length !== 1) return null
    return users[0]!
  }

  const kullaniciAdi = normalizeLoginIdentifier(raw)
  if (!kullaniciAdi) return null

  return prisma.user.findFirst({
    where: {
      kullaniciAdi: { equals: kullaniciAdi, mode: 'insensitive' },
      aktifMi: true,
      tenant: { aktifMi: true }
    },
    include: { tenant: true }
  })
}

export async function requestPasswordReset(body: ForgotPasswordBody, req: Request): Promise<{ message: string }> {
  const meta = getRequestMeta(req)
  const identifier = body.identifier.trim()

  console.info('[auth] forgot-password request received')

  const user = await findUserForPasswordReset(identifier)

  if (!user) {
    console.info('[auth] forgot-password user not found (or ambiguous email)')
    await writeAuditLog({
      tenantId: null,
      userId: null,
      action: 'AUTH_PASSWORD_RESET_REQUEST',
      meta: { outcome: 'no_matching_user' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    return { message: FORGOT_PASSWORD_PUBLIC_MESSAGE }
  }

  if (!user.eposta?.trim()) {
    console.info('[auth] forgot-password user found but has no email — userId:', user.id.slice(0, 8))
    await writeAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'AUTH_PASSWORD_RESET_REQUEST',
      meta: { outcome: 'no_email_on_account' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    return { message: FORGOT_PASSWORD_PUBLIC_MESSAGE }
  }

  console.info('[auth] forgot-password user found — userId:', user.id.slice(0, 8))

  const plainToken = generatePlainResetToken()
  const tokenHash = hashResetToken(plainToken)
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRES_MIN * 60 * 1000)

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null }
    })
    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt
      }
    })
  })

  console.info(
    '[auth] reset token created — userId:',
    user.id.slice(0, 8),
    'expiresAt:',
    expiresAt.toISOString()
  )

  await sendPasswordResetEmail({ to: user.eposta.trim().toLowerCase(), plainToken })

  await writeAuditLog({
    tenantId: user.tenantId,
    userId: user.id,
    action: 'AUTH_PASSWORD_RESET_REQUEST',
    meta: { outcome: 'token_issued' },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return { message: FORGOT_PASSWORD_PUBLIC_MESSAGE }
}

export type ActivationTokenResult = {
  plainToken: string
  expiresAt: Date
}

/**
 * Yeni hesap aktivasyonu / şifre belirleme token'ı oluşturur.
 * Mevcut forgot-password akışından bağımsız; süre ACTIVATION_TOKEN_EXPIRES_HOURS.
 */
export async function issueActivationToken(
  userId: string,
  expiresHours: number = getActivationTokenExpiresHours()
): Promise<ActivationTokenResult> {
  const plainToken = generatePlainResetToken()
  const tokenHash = hashResetToken(plainToken)
  const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000)

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({
      where: { userId, usedAt: null }
    })
    await tx.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt
      }
    })
  })

  console.info(
    '[auth] activation token created — userId:',
    userId.slice(0, 8),
    'expiresAt:',
    expiresAt.toISOString()
  )

  return { plainToken, expiresAt }
}

export async function resetPasswordWithToken(body: ResetPasswordBody, req: Request): Promise<void> {
  const meta = getRequestMeta(req)
  const tokenHash = hashResetToken(body.token)
  const now = new Date()

  const row = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: now }
    },
    include: {
      user: { include: { tenant: true } }
    }
  })

  if (!row) {
    console.info('[auth] reset-password failed — invalid or expired token')
    await writeAuditLog({
      tenantId: null,
      userId: null,
      action: 'AUTH_PASSWORD_RESET_FAILED',
      meta: { reason: 'invalid_or_expired_token' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(400, GENERIC_RESET_FAILURE, 'PASSWORD_RESET_INVALID')
  }

  if (!row.user.aktifMi || !row.user.tenant.aktifMi) {
    await writeAuditLog({
      tenantId: row.user.tenantId,
      userId: row.user.id,
      action: 'AUTH_PASSWORD_RESET_FAILED',
      meta: { reason: 'inactive_user_or_tenant' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(400, GENERIC_RESET_FAILURE, 'PASSWORD_RESET_INVALID')
  }

  const sifreHash = await bcrypt.hash(body.yeniSifre, BCRYPT_ROUNDS)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { sifreHash }
    }),
    prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: now }
    })
  ])

  console.info('[auth] reset-password success — userId:', row.userId.slice(0, 8))

  await writeAuditLog({
    tenantId: row.user.tenantId,
    userId: row.user.id,
    action: 'AUTH_PASSWORD_RESET',
    entityType: 'User',
    entityId: row.user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
}
