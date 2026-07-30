import { randomBytes, randomUUID } from 'node:crypto'
import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { signAdminAccessToken } from './adminJwt.js'
import { hashOpaqueToken } from './refreshSession.service.js'
import { ADMIN_REFRESH_COOKIE, refreshMaxAgeMs } from './sessionCookies.js'

function generateOpaqueToken(): string {
  return randomBytes(48).toString('base64url')
}

export async function createAdminRefreshSession(input: {
  adminId: string
  familyId?: string
  label?: string | null
}): Promise<{ plainToken: string; familyId: string }> {
  const plainToken = generateOpaqueToken()
  const familyId = input.familyId ?? randomUUID()
  const now = new Date()
  await prisma.adminRefreshSession.create({
    data: {
      adminId: input.adminId,
      tokenHash: hashOpaqueToken(plainToken),
      familyId,
      expiresAt: new Date(now.getTime() + refreshMaxAgeMs()),
      lastUsedAt: now,
      label: input.label?.slice(0, 64) ?? 'admin-web'
    }
  })
  return { plainToken, familyId }
}

export async function revokeAdminRefreshSessions(adminId: string): Promise<number> {
  const r = await prisma.adminRefreshSession.updateMany({
    where: { adminId, revokedAt: null },
    data: { revokedAt: new Date() }
  })
  return r.count
}

async function revokeAdminFamily(familyId: string): Promise<void> {
  await prisma.adminRefreshSession.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() }
  })
}

export async function rotateAdminRefreshSession(plainToken: string): Promise<{
  adminAccessToken: string
  refreshPlain: string
  adminUser: {
    id: string
    adSoyad: string
    kullaniciAdi: string
    eposta: string | null
    rol: string
    aktifMi: boolean
  }
}> {
  const tokenHash = hashOpaqueToken(plainToken)
  const now = new Date()
  const existing = await prisma.adminRefreshSession.findUnique({
    where: { tokenHash },
    include: { admin: true }
  })

  if (!existing) {
    throw new AppError(401, 'Admin oturumu yenilenemedi.', 'ADMIN_REFRESH_INVALID')
  }
  if (existing.revokedAt != null) {
    await revokeAdminFamily(existing.familyId)
    throw new AppError(401, 'Admin oturumu güvenlik nedeniyle sonlandırıldı.', 'ADMIN_REFRESH_REUSE')
  }
  if (existing.expiresAt.getTime() <= now.getTime()) {
    await prisma.adminRefreshSession.update({
      where: { id: existing.id },
      data: { revokedAt: now }
    })
    throw new AppError(401, 'Admin oturumu süresi doldu.', 'ADMIN_REFRESH_EXPIRED')
  }
  if (!existing.admin.aktifMi) {
    await revokeAdminFamily(existing.familyId)
    throw new AppError(401, 'Admin hesap pasif.', 'ADMIN_REFRESH_INACTIVE')
  }

  // Linked tenant user varsa pasif/silinmiş kullanıcı ile yenileme engellenir.
  if (existing.admin.linkedUserId) {
    const linked = await prisma.user.findFirst({
      where: { id: existing.admin.linkedUserId, aktifMi: true },
      select: { id: true }
    })
    if (!linked) {
      await revokeAdminFamily(existing.familyId)
      throw new AppError(401, 'Bağlı kullanıcı oturumu geçersiz.', 'ADMIN_REFRESH_LINKED_USER_GONE')
    }
  }

  const claimed = await prisma.adminRefreshSession.updateMany({
    where: { id: existing.id, revokedAt: null, tokenHash },
    data: { revokedAt: now, lastUsedAt: now }
  })
  if (claimed.count !== 1) {
    await revokeAdminFamily(existing.familyId)
    throw new AppError(401, 'Admin oturumu güvenlik nedeniyle sonlandırıldı.', 'ADMIN_REFRESH_REUSE')
  }

  const { plainToken: refreshPlain } = await createAdminRefreshSession({
    adminId: existing.adminId,
    familyId: existing.familyId,
    label: existing.label
  })

  const adminAccessToken = signAdminAccessToken({
    adminId: existing.admin.id,
    role: existing.admin.rol,
    kullaniciAdi: existing.admin.kullaniciAdi
  })

  return {
    adminAccessToken,
    refreshPlain,
    adminUser: {
      id: existing.admin.id,
      adSoyad: existing.admin.adSoyad,
      kullaniciAdi: existing.admin.kullaniciAdi,
      eposta: existing.admin.eposta,
      rol: existing.admin.rol,
      aktifMi: existing.admin.aktifMi
    }
  }
}

export async function revokeCurrentAdminRefreshFromCookie(req: Request): Promise<void> {
  const plain = req.cookies?.[ADMIN_REFRESH_COOKIE]
  if (typeof plain !== 'string' || !plain) return
  await prisma.adminRefreshSession.updateMany({
    where: { tokenHash: hashOpaqueToken(plain), revokedAt: null },
    data: { revokedAt: new Date() }
  })
}
