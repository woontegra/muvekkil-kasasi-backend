import { Prisma, WhatsAppMesajPaketTalepDurum } from '@prisma/client'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import { writeAdminAuditLog } from './adminAudit.service.js'
import {
  adminListWhatsAppMesajPaketTalepleri,
  adminOnaylaWhatsAppMesajPaketTalebi,
  adminReddetWhatsAppMesajPaketTalebi
} from '../tahsilatBildirim/whatsappMesajPaketTalep.service.js'

export async function adminListPaketTalepleri(opts: {
  durum?: WhatsAppMesajPaketTalepDurum
  tenantId?: string
  limit?: number
  offset?: number
}) {
  const out = await adminListWhatsAppMesajPaketTalepleri(opts)
  return { ok: true as const, ...out }
}

export async function adminOnaylaPaketTalebi(input: {
  talepId: string
  adminId: string
  req: Request
  adminNotu?: string | null
}) {
  const out = await adminOnaylaWhatsAppMesajPaketTalebi({
    talepId: input.talepId,
    adminId: input.adminId,
    adminNotu: input.adminNotu
  })
  const meta = getRequestMeta(input.req)
  try {
    await writeAdminAuditLog({
      adminId: input.adminId,
      action: 'WHATSAPP_PAKET_TALEP_ONAYLANDI',
      entityType: 'WhatsAppMesajPaketTalebi',
      entityId: input.talepId,
      newValue: {
        tenantId: out.talep.tenantId,
        packageId: out.talep.packageId,
        mesajAdedi: out.talep.mesajAdedi,
        fiyatTL: out.talep.fiyatTL,
        oncekiBakiye: out.credit.oncekiBakiye,
        sonrakiBakiye: out.credit.sonrakiBakiye,
        alreadyApplied: out.credit.alreadyApplied,
        adminNotu: input.adminNotu ?? null
      } as unknown as Prisma.InputJsonValue,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
  } catch (err) {
    // Onay iş kuralı tamamlandı; audit hatası kullanıcıya “başarısız onay” göstermesin.
    // eslint-disable-next-line no-console
    console.error('[adminOnaylaPaketTalebi] audit log failed', err)
  }
  return { ok: true as const, ...out }
}

export async function adminReddetPaketTalebi(input: {
  talepId: string
  adminId: string
  req: Request
  adminNotu?: string | null
}) {
  const talep = await adminReddetWhatsAppMesajPaketTalebi({
    talepId: input.talepId,
    adminId: input.adminId,
    adminNotu: input.adminNotu
  })
  const meta = getRequestMeta(input.req)
  try {
    await writeAdminAuditLog({
      adminId: input.adminId,
      action: 'WHATSAPP_PAKET_TALEP_REDDEDILDI',
      entityType: 'WhatsAppMesajPaketTalebi',
      entityId: input.talepId,
      newValue: {
        tenantId: talep.tenantId,
        packageId: talep.packageId,
        adminNotu: input.adminNotu ?? null
      } as unknown as Prisma.InputJsonValue,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[adminReddetPaketTalebi] audit log failed', err)
  }
  return { ok: true as const, talep }
}
