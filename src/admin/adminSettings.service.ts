import type { Prisma } from '@prisma/client'
import bcrypt from 'bcrypt'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Request } from 'express'
import type { z } from 'zod'
import { getRequestMeta } from '../auth/requestMeta.js'
import { env } from '../config/env.js'
import { AppError } from '../middleware/errorHandler.js'
import { prisma } from '../lib/prisma.js'
import { adminProfileUpdateSchema, adminSelfChangePasswordSchema } from './admin.schemas.js'
import { hashPassword, serializeSuperAdmin } from './adminAuth.service.js'
import { writeAdminAuditLog } from './adminAudit.service.js'

type ProfileBody = z.infer<typeof adminProfileUpdateSchema>
type ChangePwdBody = z.infer<typeof adminSelfChangePasswordSchema>

const pkgVersion = (() => {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    const raw = readFileSync(join(dir, '../../package.json'), 'utf8')
    const j = JSON.parse(raw) as { version?: string }
    return j.version ?? '1.0.0'
  } catch {
    return '1.0.0'
  }
})()

export async function adminGetSettingsProfile(adminId: string) {
  const a = await prisma.superAdmin.findUnique({ where: { id: adminId } })
  if (!a) throw new AppError(404, 'Profil bulunamadı.', 'NOT_FOUND')
  return serializeSuperAdmin(a)
}

export async function adminUpdateSettingsProfile(adminId: string, body: ProfileBody, req: Request) {
  const existing = await prisma.superAdmin.findUnique({ where: { id: adminId } })
  if (!existing) throw new AppError(404, 'Profil bulunamadı.', 'NOT_FOUND')

  const data: Prisma.SuperAdminUpdateInput = {}
  if (body.adSoyad !== undefined) data.adSoyad = body.adSoyad.trim()
  if (body.eposta !== undefined) data.eposta = body.eposta?.trim() ? body.eposta.trim().toLowerCase() : null

  if (body.eposta !== undefined && data.eposta) {
    const clash = await prisma.superAdmin.findFirst({
      where: { eposta: data.eposta as string, id: { not: adminId } }
    })
    if (clash) throw new AppError(409, 'Bu e-posta başka bir adminde kullanılıyor.', 'DUPLICATE_EMAIL')
  }

  const meta = getRequestMeta(req)
  const updated = await prisma.superAdmin.update({ where: { id: adminId }, data })

  await writeAdminAuditLog({
    adminId,
    action: 'ADMIN_PROFILE_UPDATED',
    entityType: 'SuperAdmin',
    entityId: adminId,
    oldValue: { adSoyad: existing.adSoyad, eposta: existing.eposta } as unknown as Prisma.InputJsonValue,
    newValue: { adSoyad: updated.adSoyad, eposta: updated.eposta } as unknown as Prisma.InputJsonValue,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeSuperAdmin(updated)
}

export async function adminChangeOwnPassword(adminId: string, body: ChangePwdBody, req: Request): Promise<void> {
  const a = await prisma.superAdmin.findUnique({ where: { id: adminId } })
  if (!a) throw new AppError(404, 'Profil bulunamadı.', 'NOT_FOUND')

  const ok = await bcrypt.compare(body.mevcutSifre, a.sifreHash)
  if (!ok) throw new AppError(401, 'Mevcut şifre hatalı.', 'INVALID_PASSWORD')

  const sifreHash = await hashPassword(body.yeniSifre)
  const meta = getRequestMeta(req)
  await prisma.superAdmin.update({ where: { id: adminId }, data: { sifreHash } })

  await writeAdminAuditLog({
    adminId,
    action: 'ADMIN_PASSWORD_CHANGED',
    entityType: 'SuperAdmin',
    entityId: adminId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
}

export function adminGetSystemInfo(req: Request) {
  const frontendDomain = env.PUBLIC_APP_URL ?? env.CORS_ORIGIN
  const backendDomain = req.get('host') ? `${req.protocol}://${req.get('host')}` : `http://localhost:${env.PORT}`
  return {
    apiStatus: 'UP' as const,
    frontendDomain,
    backendDomain,
    environment: env.NODE_ENV,
    version: pkgVersion
  }
}
