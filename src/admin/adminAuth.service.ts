import bcrypt from 'bcrypt'
import type { SuperAdmin } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { signAdminAccessToken } from '../auth/adminJwt.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { writeAdminAuditLog } from './adminAudit.service.js'
import { AppError } from '../middleware/errorHandler.js'
import type { Request } from 'express'
import type { AdminLoginBody } from './admin.schemas.js'

const BCRYPT_ROUNDS = 12

export type PublicSuperAdmin = Omit<SuperAdmin, 'sifreHash'>

export function serializeSuperAdmin(a: SuperAdmin): PublicSuperAdmin {
  const { sifreHash: _, ...rest } = a
  return rest as PublicSuperAdmin
}

export async function adminLogin(body: AdminLoginBody, req: Request): Promise<{ adminAccessToken: string; adminUser: PublicSuperAdmin }> {
  const meta = getRequestMeta(req)
  const raw = body.identifier.trim()
  const isEmail = raw.includes('@')

  const admin = await prisma.superAdmin.findFirst({
    where: isEmail
      ? { eposta: { equals: raw.toLowerCase(), mode: 'insensitive' }, aktifMi: true }
      : { kullaniciAdi: { equals: raw, mode: 'insensitive' }, aktifMi: true }
  })

  if (!admin) {
    await writeAdminAuditLog({
      adminId: null,
      action: 'ADMIN_LOGIN_FAILED',
      newValue: { reason: 'NOT_FOUND', identifier: raw },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(401, 'Kullanıcı adı/e-posta veya şifre hatalı.', 'INVALID_CREDENTIALS')
  }

  const ok = await bcrypt.compare(body.sifre, admin.sifreHash)
  if (!ok) {
    await writeAdminAuditLog({
      adminId: admin.id,
      action: 'ADMIN_LOGIN_FAILED',
      newValue: { reason: 'BAD_PASSWORD' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(401, 'Kullanıcı adı/e-posta veya şifre hatalı.', 'INVALID_CREDENTIALS')
  }

  const updated = await prisma.superAdmin.update({
    where: { id: admin.id },
    data: { sonGirisTarihi: new Date() }
  })

  await writeAdminAuditLog({
    adminId: updated.id,
    action: 'ADMIN_LOGIN_SUCCESS',
    entityType: 'SuperAdmin',
    entityId: updated.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  const adminAccessToken = signAdminAccessToken({
    adminId: updated.id,
    role: updated.rol,
    kullaniciAdi: updated.kullaniciAdi
  })

  return { adminAccessToken, adminUser: serializeSuperAdmin(updated) }
}

export async function getAdminMe(adminId: string): Promise<PublicSuperAdmin | null> {
  const a = await prisma.superAdmin.findFirst({ where: { id: adminId, aktifMi: true } })
  return a ? serializeSuperAdmin(a) : null
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}
