import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

export type AuditWriteInput = {
  tenantId?: string | null
  userId?: string | null
  action: string
  entityType?: string | null
  entityId?: string | null
  oldValue?: unknown
  newValue?: unknown
  meta?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
}

export async function writeAuditLog(input: AuditWriteInput): Promise<void> {
  const meta: Prisma.InputJsonValue | undefined =
    input.meta == null ? undefined : (input.meta as Prisma.InputJsonValue)
  const oldValue: Prisma.InputJsonValue | undefined =
    input.oldValue === undefined ? undefined : (input.oldValue as Prisma.InputJsonValue)
  const newValue: Prisma.InputJsonValue | undefined =
    input.newValue === undefined ? undefined : (input.newValue as Prisma.InputJsonValue)

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId ?? undefined,
      userId: input.userId ?? undefined,
      action: input.action,
      entityType: input.entityType ?? undefined,
      entityId: input.entityId ?? undefined,
      oldValue,
      newValue,
      meta,
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined
    }
  })
}

export type AuditLogListItem = {
  id: string
  action: string
  entityType: string | null
  entityId: string | null
  userAdSoyad: string | null
  userKullaniciAdi: string | null
  ipAddress: string | null
  createdAt: string
}

export async function listAuditLogsForTenant(
  tenantId: string,
  page: number,
  limit: number
): Promise<{ items: AuditLogListItem[]; total: number; page: number; limit: number }> {
  const skip = (page - 1) * limit
  const where = { tenantId }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        user: { select: { adSoyad: true, kullaniciAdi: true } }
      }
    }),
    prisma.auditLog.count({ where })
  ])

  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      userAdSoyad: r.user?.adSoyad ?? null,
      userKullaniciAdi: r.user?.kullaniciAdi ?? null,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString()
    })),
    total,
    page,
    limit
  }
}
