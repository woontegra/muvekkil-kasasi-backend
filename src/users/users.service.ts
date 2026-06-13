import bcrypt from 'bcrypt'
import type { Prisma, User } from '@prisma/client'
import { UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import { serializeUser } from '../auth/auth.service.js'
import type { CreateUserBody, ListUsersQuery, ResetUserPasswordBody, UpdateUserBody } from './users.schemas.js'

const BCRYPT_ROUNDS = 12

function roleRank(r: UserRole): number {
  if (r === UserRole.BURO_SAHIBI) return 3
  if (r === UserRole.AVUKAT_YONETICI) return 2
  return 1
}

export function serializePublicUser(u: User) {
  return serializeUser(u)
}

export async function listUsersForTenant(tenantId: string, query: ListUsersQuery): Promise<{ items: User[]; total: number }> {
  const { q, rol, aktifMi, page, limit } = query
  const skip = (page - 1) * limit

  const where: Prisma.UserWhereInput = {
    tenantId,
    ...(rol ? { role: rol } : {}),
    ...(aktifMi !== undefined ? { aktifMi } : {}),
    ...(q.length > 0
      ? {
          OR: [
            { adSoyad: { contains: q, mode: 'insensitive' } },
            { kullaniciAdi: { contains: q, mode: 'insensitive' } },
            { eposta: { contains: q, mode: 'insensitive' } }
          ]
        }
      : {})
  }

  const [total, items] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ aktifMi: 'desc' }, { adSoyad: 'asc' }],
      skip,
      take: limit
    })
  ])

  return { items, total }
}

export async function getUserForTenant(tenantId: string, userId: string): Promise<User | null> {
  return prisma.user.findFirst({
    where: { id: userId, tenantId }
  })
}

export async function createUserInTenant(
  tenantId: string,
  actorUserId: string,
  body: CreateUserBody,
  req: Request
): Promise<User> {
  const meta = getRequestMeta(req)

  const taken = await prisma.user.findFirst({
    where: { kullaniciAdi: { equals: body.kullaniciAdi, mode: 'insensitive' } }
  })
  if (taken) {
    throw new AppError(409, 'Bu kullanıcı adı kullanılıyor.', 'USERNAME_TAKEN')
  }

  if (body.eposta) {
    const emailTaken = await prisma.user.findFirst({
      where: { tenantId, eposta: body.eposta }
    })
    if (emailTaken) {
      throw new AppError(409, 'Bu e-posta bu büroda zaten kayıtlı.', 'EMAIL_TAKEN')
    }
  }

  const sifreHash = await bcrypt.hash(body.sifre, BCRYPT_ROUNDS)

  const created = await prisma.user.create({
    data: {
      tenantId,
      adSoyad: body.adSoyad.trim(),
      kullaniciAdi: body.kullaniciAdi,
      eposta: body.eposta,
      telefon: body.telefon,
      sifreHash,
      role: body.rol,
      aktifMi: true
    }
  })

  await writeAuditLog({
    tenantId,
    userId: actorUserId,
    action: 'USER_CREATED',
    entityType: 'User',
    entityId: created.id,
    newValue: { kullaniciAdi: created.kullaniciAdi, role: created.role },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return created
}

export async function updateUserInTenant(
  tenantId: string,
  actorUserId: string,
  actorRole: UserRole,
  targetUserId: string,
  body: UpdateUserBody,
  req: Request
): Promise<User> {
  const meta = getRequestMeta(req)

  const existing = await prisma.user.findFirst({
    where: { id: targetUserId, tenantId }
  })
  if (!existing) {
    throw new AppError(404, 'Kullanıcı bulunamadı.', 'NOT_FOUND')
  }

  if (existing.role === UserRole.BURO_SAHIBI) {
    if (targetUserId !== actorUserId) {
      throw new AppError(403, 'Bu kullanıcı düzenlenemez.', 'FORBIDDEN')
    }
    if (body.rol !== UserRole.BURO_SAHIBI || body.aktifMi !== true) {
      throw new AppError(400, 'Büro sahibi rolü veya aktiflik bu ekrandan değiştirilemez.', 'FOUNDER_FIELDS_LOCKED')
    }
    if (body.eposta && body.eposta !== existing.eposta) {
      const emailTaken = await prisma.user.findFirst({
        where: { tenantId, eposta: body.eposta, NOT: { id: targetUserId } }
      })
      if (emailTaken) {
        throw new AppError(409, 'Bu e-posta bu büroda zaten kayıtlı.', 'EMAIL_TAKEN')
      }
    }
    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        adSoyad: body.adSoyad.trim(),
        eposta: body.eposta,
        telefon: body.telefon
      }
    })
    await writeAuditLog({
      tenantId,
      userId: actorUserId,
      action: 'USER_UPDATED',
      entityType: 'User',
      entityId: targetUserId,
      oldValue: { adSoyad: existing.adSoyad, eposta: existing.eposta, telefon: existing.telefon },
      newValue: { adSoyad: updated.adSoyad, eposta: updated.eposta, telefon: updated.telefon },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    return updated
  }

  if (body.rol === UserRole.BURO_SAHIBI) {
    throw new AppError(400, 'Büro sahibi rolü bu API ile atanamaz.', 'BURO_ROLE_FORBIDDEN')
  }

  if (targetUserId === actorUserId) {
    if (!body.aktifMi) {
      throw new AppError(400, 'Kendi hesabınızı pasifleştiremezsiniz.', 'SELF_DEACTIVATE_FORBIDDEN')
    }
    if (roleRank(body.rol) < roleRank(actorRole)) {
      throw new AppError(400, 'Kendi rolünüzü düşüremezsiniz.', 'SELF_ROLE_DOWNGRADE_FORBIDDEN')
    }
  }

  if (body.eposta && body.eposta !== existing.eposta) {
    const emailTaken = await prisma.user.findFirst({
      where: { tenantId, eposta: body.eposta, NOT: { id: targetUserId } }
    })
    if (emailTaken) {
      throw new AppError(409, 'Bu e-posta bu büroda zaten kayıtlı.', 'EMAIL_TAKEN')
    }
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: {
      adSoyad: body.adSoyad.trim(),
      eposta: body.eposta,
      telefon: body.telefon,
      role: body.rol,
      aktifMi: body.aktifMi
    }
  })

  await writeAuditLog({
    tenantId,
    userId: actorUserId,
    action: 'USER_UPDATED',
    entityType: 'User',
    entityId: targetUserId,
    oldValue: {
      adSoyad: existing.adSoyad,
      eposta: existing.eposta,
      telefon: existing.telefon,
      role: existing.role,
      aktifMi: existing.aktifMi
    },
    newValue: {
      adSoyad: updated.adSoyad,
      eposta: updated.eposta,
      telefon: updated.telefon,
      role: updated.role,
      aktifMi: updated.aktifMi
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return updated
}

export async function resetUserPasswordInTenant(
  tenantId: string,
  actorUserId: string,
  targetUserId: string,
  body: ResetUserPasswordBody,
  req: Request
): Promise<void> {
  const meta = getRequestMeta(req)
  const existing = await prisma.user.findFirst({
    where: { id: targetUserId, tenantId }
  })
  if (!existing) {
    throw new AppError(404, 'Kullanıcı bulunamadı.', 'NOT_FOUND')
  }

  const sifreHash = await bcrypt.hash(body.yeniSifre, BCRYPT_ROUNDS)
  await prisma.user.update({
    where: { id: targetUserId },
    data: { sifreHash }
  })

  await writeAuditLog({
    tenantId,
    userId: actorUserId,
    action: 'USER_PASSWORD_RESET_BY_ADMIN',
    entityType: 'User',
    entityId: targetUserId,
    meta: { targetKullaniciAdi: existing.kullaniciAdi },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
}

export async function deactivateUserInTenant(
  tenantId: string,
  actorUserId: string,
  targetUserId: string,
  req: Request
): Promise<User> {
  const meta = getRequestMeta(req)

  if (targetUserId === actorUserId) {
    throw new AppError(400, 'Kendi hesabınızı pasifleştiremezsiniz.', 'SELF_DEACTIVATE_FORBIDDEN')
  }

  const existing = await prisma.user.findFirst({
    where: { id: targetUserId, tenantId }
  })
  if (!existing) {
    throw new AppError(404, 'Kullanıcı bulunamadı.', 'NOT_FOUND')
  }

  if (!existing.aktifMi) {
    return existing
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { aktifMi: false }
  })

  await writeAuditLog({
    tenantId,
    userId: actorUserId,
    action: 'USER_DEACTIVATED',
    entityType: 'User',
    entityId: targetUserId,
    oldValue: { aktifMi: true },
    newValue: { aktifMi: false },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return updated
}
