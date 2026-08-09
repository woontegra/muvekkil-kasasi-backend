import type { Prisma, Tenant } from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import type { TenantProfileUpdateBody } from './tenant.schemas.js'

export async function updateTenantProfile(
  tenantId: string,
  userId: string,
  body: TenantProfileUpdateBody,
  req: Request
): Promise<Tenant> {
  const existing = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!existing) throw new AppError(404, 'Büro bulunamadı.', 'NOT_FOUND')

  const data: Prisma.TenantUpdateInput = {}
  if (body.buroAdi !== undefined) data.buroAdi = body.buroAdi
  if (body.telefon !== undefined) data.telefon = body.telefon
  if (body.eposta !== undefined) data.eposta = body.eposta
  if (body.adres !== undefined) data.adres = body.adres
  if (body.vergiNo !== undefined) data.vergiNo = body.vergiNo
  if (body.vergiDairesi !== undefined) data.vergiDairesi = body.vergiDairesi

  const meta = getRequestMeta(req)
  const updated = await prisma.tenant.update({ where: { id: tenantId }, data })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'TENANT_PROFILE_UPDATED',
    entityType: 'Tenant',
    entityId: tenantId,
    oldValue: {
      buroAdi: existing.buroAdi,
      telefon: existing.telefon,
      eposta: existing.eposta,
      adres: existing.adres,
      vergiNo: existing.vergiNo,
      vergiDairesi: existing.vergiDairesi
    },
    newValue: {
      buroAdi: updated.buroAdi,
      telefon: updated.telefon,
      eposta: updated.eposta,
      adres: updated.adres,
      vergiNo: updated.vergiNo,
      vergiDairesi: updated.vergiDairesi
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return updated
}
