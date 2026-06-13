import type { Prisma, SuperAdmin } from '@prisma/client'
import crypto from 'node:crypto'
import type { Request } from 'express'
import type { z } from 'zod'
import { getRequestMeta } from '../auth/requestMeta.js'
import { AppError } from '../middleware/errorHandler.js'
import { prisma } from '../lib/prisma.js'
import { adminSuperAdminCreateSchema, adminSuperAdminUpdateSchema } from './admin.schemas.js'
import { hashPassword, serializeSuperAdmin } from './adminAuth.service.js'
import { writeAdminAuditLog } from './adminAudit.service.js'

type CreateBody = z.infer<typeof adminSuperAdminCreateSchema>
type UpdateBody = z.infer<typeof adminSuperAdminUpdateSchema>

export async function adminListSuperAdmins() {
  const rows = await prisma.superAdmin.findMany({
    orderBy: [{ aktifMi: 'desc' }, { createdAt: 'desc' }]
  })
  return rows.map((r) => serializeSuperAdmin(r))
}

export async function adminCreateSuperAdmin(body: CreateBody, actorId: string, req: Request) {
  const meta = getRequestMeta(req)
  const kullaniciAdi = body.kullaniciAdi.trim()
  const eposta = body.eposta?.trim() ? body.eposta.trim().toLowerCase() : null

  const dup = await prisma.superAdmin.findFirst({
    where: {
      OR: [
        { kullaniciAdi: { equals: kullaniciAdi, mode: 'insensitive' } },
        ...(eposta ? [{ eposta: { equals: eposta, mode: 'insensitive' as const } }] : [])
      ]
    }
  })
  if (dup) throw new AppError(409, 'Bu kullanıcı adı veya e-posta zaten kayıtlı.', 'DUPLICATE')

  const sifreHash = await hashPassword(body.sifre)
  const created = await prisma.superAdmin.create({
    data: {
      adSoyad: body.adSoyad.trim(),
      kullaniciAdi,
      eposta,
      sifreHash,
      rol: body.rol,
      aktifMi: true
    }
  })

  await writeAdminAuditLog({
    adminId: actorId,
    action: 'ADMIN_USER_CREATED',
    entityType: 'SuperAdmin',
    entityId: created.id,
    newValue: { kullaniciAdi: created.kullaniciAdi, rol: created.rol },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeSuperAdmin(created)
}

async function assertCanChangeSuperAdminRoleOrActive(target: SuperAdmin, patch: UpdateBody): Promise<void> {
  if (target.rol !== 'SUPER_ADMIN' || !target.aktifMi) return
  const demote = patch.rol !== undefined && patch.rol !== 'SUPER_ADMIN'
  const deactivate = patch.aktifMi === false
  if (!demote && !deactivate) return
  const activeSuper = await prisma.superAdmin.count({ where: { aktifMi: true, rol: 'SUPER_ADMIN' } })
  if (activeSuper <= 1) {
    throw new AppError(400, 'Son aktif süper admin pasifleştirilemez veya rolü değiştirilemez.', 'LAST_SUPER_ADMIN')
  }
}

export async function adminUpdateSuperAdmin(id: string, body: UpdateBody, actorId: string, req: Request) {
  if (id === actorId && body.aktifMi === false) {
    throw new AppError(400, 'Kendi hesabınızı pasifleştiremezsiniz.', 'SELF_DEACTIVATE')
  }

  const target = await prisma.superAdmin.findUnique({ where: { id } })
  if (!target) throw new AppError(404, 'Admin kullanıcısı bulunamadı.', 'NOT_FOUND')

  await assertCanChangeSuperAdminRoleOrActive(target, body)

  const meta = getRequestMeta(req)
  const data: Prisma.SuperAdminUpdateInput = {}
  if (body.adSoyad !== undefined) data.adSoyad = body.adSoyad.trim()
  if (body.eposta !== undefined) data.eposta = body.eposta?.trim() ? body.eposta.trim().toLowerCase() : null
  if (body.rol !== undefined) data.rol = body.rol
  if (body.aktifMi !== undefined) data.aktifMi = body.aktifMi

  const updated = await prisma.superAdmin.update({ where: { id }, data })

  await writeAdminAuditLog({
    adminId: actorId,
    action: 'ADMIN_USER_UPDATED',
    entityType: 'SuperAdmin',
    entityId: id,
    oldValue: serializeSuperAdmin(target) as unknown as Prisma.InputJsonValue,
    newValue: serializeSuperAdmin(updated) as unknown as Prisma.InputJsonValue,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeSuperAdmin(updated)
}

export async function adminResetSuperAdminPassword(
  id: string,
  plain: string | undefined,
  actorId: string,
  req: Request
): Promise<{ geciciSifre: string }> {
  const u = await prisma.superAdmin.findUnique({ where: { id } })
  if (!u) throw new AppError(404, 'Admin kullanıcısı bulunamadı.', 'NOT_FOUND')

  const geciciSifre = plain?.trim() || crypto.randomBytes(12).toString('base64url').slice(0, 16)
  const sifreHash = await hashPassword(geciciSifre)
  const meta = getRequestMeta(req)
  await prisma.superAdmin.update({ where: { id }, data: { sifreHash } })

  await writeAdminAuditLog({
    adminId: actorId,
    action: 'ADMIN_USER_PASSWORD_RESET',
    entityType: 'SuperAdmin',
    entityId: id,
    newValue: { resetAt: new Date().toISOString() },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return { geciciSifre }
}

export async function adminSetSuperAdminActive(id: string, aktif: boolean, actorId: string, req: Request) {
  if (id === actorId && !aktif) {
    throw new AppError(400, 'Kendi hesabınızı pasifleştiremezsiniz.', 'SELF_DEACTIVATE')
  }

  const u = await prisma.superAdmin.findUnique({ where: { id } })
  if (!u) throw new AppError(404, 'Admin kullanıcısı bulunamadı.', 'NOT_FOUND')

  if (!aktif && u.rol === 'SUPER_ADMIN' && u.aktifMi) {
    const c = await prisma.superAdmin.count({ where: { aktifMi: true, rol: 'SUPER_ADMIN' } })
    if (c <= 1) throw new AppError(400, 'Son aktif süper admin pasifleştirilemez.', 'LAST_SUPER_ADMIN')
  }

  const meta = getRequestMeta(req)
  const updated = await prisma.superAdmin.update({ where: { id }, data: { aktifMi: aktif } })

  await writeAdminAuditLog({
    adminId: actorId,
    action: aktif ? 'ADMIN_USER_ACTIVATED' : 'ADMIN_USER_DEACTIVATED',
    entityType: 'SuperAdmin',
    entityId: id,
    oldValue: { aktifMi: u.aktifMi } as unknown as Prisma.InputJsonValue,
    newValue: { aktifMi: aktif } as unknown as Prisma.InputJsonValue,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeSuperAdmin(updated)
}
