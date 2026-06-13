import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

export type AdminAuditInput = {
  adminId: string | null
  action: string
  entityType?: string | null
  entityId?: string | null
  oldValue?: Prisma.InputJsonValue | null
  newValue?: Prisma.InputJsonValue | null
  ipAddress?: string | null
  userAgent?: string | null
}

export async function writeAdminAuditLog(input: AdminAuditInput): Promise<void> {
  const data: Prisma.AdminAuditLogCreateInput = {
    action: input.action,
    entityType: input.entityType ?? undefined,
    entityId: input.entityId ?? undefined,
    ipAddress: input.ipAddress ?? undefined,
    userAgent: input.userAgent ?? undefined
  }
  if (input.adminId) {
    data.admin = { connect: { id: input.adminId } }
  }
  if (input.oldValue !== undefined && input.oldValue !== null) {
    data.oldValue = input.oldValue
  }
  if (input.newValue !== undefined && input.newValue !== null) {
    data.newValue = input.newValue
  }
  await prisma.adminAuditLog.create({ data })
}
