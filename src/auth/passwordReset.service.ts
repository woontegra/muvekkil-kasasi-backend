import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcrypt'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { sendPasswordResetEmail } from '../mail/mail.service.js'
import type { ForgotPasswordBody, ResetPasswordBody } from './auth.schemas.js'
import { getRequestMeta } from './requestMeta.js'

export const FORGOT_PASSWORD_PUBLIC_MESSAGE =
  'Eğer bu e-posta sistemde kayıtlıysa şifre sıfırlama bağlantısı gönderilecektir.'

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

export async function requestPasswordReset(body: ForgotPasswordBody, req: Request): Promise<{ message: string }> {
  const meta = getRequestMeta(req)
  const email = body.eposta.trim().toLowerCase()

  const users = await prisma.user.findMany({
    where: {
      eposta: { equals: email, mode: 'insensitive' },
      aktifMi: true,
      tenant: { aktifMi: true }
    },
    include: { tenant: true }
  })

  if (users.length !== 1) {
    await writeAuditLog({
      tenantId: null,
      userId: null,
      action: 'AUTH_PASSWORD_RESET_REQUEST',
      meta: {
        outcome: users.length === 0 ? 'no_matching_user' : 'ambiguous_email'
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    return { message: FORGOT_PASSWORD_PUBLIC_MESSAGE }
  }

  const user = users[0]!
  if (!user.eposta) {
    return { message: FORGOT_PASSWORD_PUBLIC_MESSAGE }
  }

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

  await sendPasswordResetEmail({ to: user.eposta, plainToken })

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
