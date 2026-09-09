import { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import { AppError } from '../middleware/errorHandler.js'
import { prisma } from '../lib/prisma.js'
import {
  adjustManuelCredit,
  getTransactions,
  getWhatsAppMesajKrediOzet
} from '../tahsilatBildirim/whatsappMesajKredi.service.js'
import { writeAdminAuditLog } from './adminAudit.service.js'

async function assertTenantExists(tenantId: string): Promise<void> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
  if (!t) {
    throw new AppError(404, 'Tenant bulunamadı.', 'TENANT_NOT_FOUND')
  }
}

export async function adminGetTenantWhatsAppKredi(tenantId: string) {
  await assertTenantExists(tenantId)
  const ozet = await getWhatsAppMesajKrediOzet(tenantId)
  return { ok: true as const, tenantId, ...ozet }
}

export async function adminListTenantWhatsAppKrediHareketler(
  tenantId: string,
  opts?: { limit?: number; offset?: number }
) {
  await assertTenantExists(tenantId)
  const out = await getTransactions(tenantId, opts)
  return {
    ok: true as const,
    tenantId,
    total: out.total,
    items: out.items.map((h) => ({
      id: h.id,
      tip: h.tip,
      miktar: h.miktar,
      oncekiBakiye: h.oncekiBakiye,
      sonrakiBakiye: h.sonrakiBakiye,
      aciklama: h.aciklama,
      createdAt: h.createdAt.toISOString()
    }))
  }
}

export async function adminAdjustTenantWhatsAppKredi(input: {
  tenantId: string
  adminId: string
  req: Request
  yon: 'EKLE' | 'DUS'
  miktar: number
  aciklama?: string | null
}) {
  await assertTenantExists(input.tenantId)

  const note =
    input.aciklama?.trim() || 'Platform Admin manuel kredi işlemi'

  const result = await adjustManuelCredit({
    tenantId: input.tenantId,
    amount: input.miktar,
    yon: input.yon,
    aciklama: note
  })

  const meta = getRequestMeta(input.req)
  await writeAdminAuditLog({
    adminId: input.adminId,
    action: 'TENANT_WHATSAPP_KREDI_ADJUSTED',
    entityType: 'WhatsAppMesajKredisi',
    entityId: input.tenantId,
    newValue: {
      yon: input.yon,
      miktar: input.miktar,
      aciklama: note,
      oncekiBakiye: result.oncekiBakiye,
      sonrakiBakiye: result.sonrakiBakiye
    } as unknown as Prisma.InputJsonValue,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  const ozet = await getWhatsAppMesajKrediOzet(input.tenantId)
  return {
    ok: true as const,
    tenantId: input.tenantId,
    yon: input.yon,
    miktar: input.miktar,
    oncekiBakiye: result.oncekiBakiye,
    sonrakiBakiye: result.sonrakiBakiye,
    ozet
  }
}
