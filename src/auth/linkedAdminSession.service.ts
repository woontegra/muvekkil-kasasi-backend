import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'
import { signAdminAccessToken } from './adminJwt.js'
import { createAdminRefreshSession } from './adminRefreshSession.service.js'
import { serializeSuperAdmin, type PublicSuperAdmin } from '../admin/adminAuth.service.js'
import { writeAdminAuditLog } from '../admin/adminAudit.service.js'
import { getRequestMeta } from './requestMeta.js'

export type LinkedAdminSessionResult = {
  adminAccessToken: string
  adminUser: PublicSuperAdmin
  refreshPlain: string
} | null

/**
 * Tenant User başarıyla doğrulandıktan sonra linked SUPER_ADMIN varsa admin oturumu üretir.
 * Parola yeniden kontrol edilmez. Bağlantı yoksa / pasifse null döner (tenant login bozulmaz).
 */
export async function tryCreateLinkedAdminSession(
  userId: string,
  req: Request
): Promise<LinkedAdminSessionResult> {
  try {
    const admin = await prisma.superAdmin.findFirst({
      where: {
        linkedUserId: userId,
        aktifMi: true,
        rol: 'SUPER_ADMIN'
      }
    })
    if (!admin) return null

    const linkedUser = await prisma.user.findFirst({
      where: { id: userId, aktifMi: true },
      select: { id: true }
    })
    if (!linkedUser) return null

    const updated = await prisma.superAdmin.update({
      where: { id: admin.id },
      data: { sonGirisTarihi: new Date() }
    })

    const meta = getRequestMeta(req)
    await writeAdminAuditLog({
      adminId: updated.id,
      action: 'ADMIN_SESSION_FROM_TENANT_LOGIN',
      entityType: 'SuperAdmin',
      entityId: updated.id,
      newValue: { linkedUserId: userId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })

    const adminAccessToken = signAdminAccessToken({
      adminId: updated.id,
      role: updated.rol,
      kullaniciAdi: updated.kullaniciAdi
    })
    const { plainToken } = await createAdminRefreshSession({
      adminId: updated.id,
      label: 'linked-tenant-web'
    })

    return {
      adminAccessToken,
      adminUser: serializeSuperAdmin(updated),
      refreshPlain: plainToken
    }
  } catch (err) {
    console.error('[admin] linked session create failed (tenant login continues)', err)
    return null
  }
}

/** Tenant access token sahibi için admin oturumunu yeniden aç (parolasız; linkedUserId zorunlu). */
export async function elevateAdminSessionFromTenantUser(
  userId: string,
  req: Request
): Promise<LinkedAdminSessionResult> {
  return tryCreateLinkedAdminSession(userId, req)
}
