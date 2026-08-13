import { WhatsAppBaglantiDurumu } from '@prisma/client'
import type { Request } from 'express'
import { writeAdminAuditLog } from '../admin/adminAudit.service.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { env } from '../config/env.js'
import { encryptSecret, resolveTokenEncryptionKey } from '../lib/secretCrypto.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { getPublicConnectionStatus, maskMetaId } from './connection.public.js'
import { ensureTenantBildirimDefaults } from './settings.service.js'
import { verifyExistingWabaPhoneAssets } from './meta/verifyExistingAssets.js'

export type ImportExistingConnectionInput = {
  tenantId: string
  wabaId: string
  phoneNumberId: string
}

/**
 * SUPER_ADMIN: mevcut Meta WABA/Phone’u tenant’a import et.
 * - Token yalnızca WHATSAPP_WOONTEGRA_SYSTEM_USER_TOKEN env’den (zorunlu)
 * - WHATSAPP_CLOUD_TEST_PHONE okunmaz / gerekmez
 * - Gönderici phone_number_id connection kaydından gelir; alıcı production’da müvekkil telefonudur
 * - Webhook override / subscribed_apps / register YOK
 * - MailCenter bağımlılığı YOK
 */
export async function importExistingMetaConnection(
  adminId: string,
  input: ImportExistingConnectionInput,
  req: Request,
  deps?: { fetchImpl?: typeof fetch; accessTokenOverride?: string; dryRun?: boolean }
): Promise<Record<string, unknown>> {
  if (!env.WHATSAPP_CLOUD_API_ENABLED) {
    throw new AppError(503, 'WhatsApp Cloud API özelliği kapalı.', 'FEATURE_DISABLED')
  }

  const tenantId = input.tenantId.trim()
  const wabaId = input.wabaId.trim()
  const phoneNumberId = input.phoneNumberId.trim()
  if (!tenantId || !wabaId || !phoneNumberId) {
    throw new AppError(400, 'tenantId, wabaId ve phoneNumberId zorunludur.', 'INVALID_INPUT')
  }

  const accessToken =
    deps?.accessTokenOverride?.trim() || env.WHATSAPP_WOONTEGRA_SYSTEM_USER_TOKEN?.trim() || ''
  if (!accessToken) {
    throw new AppError(
      503,
      'WHATSAPP_WOONTEGRA_SYSTEM_USER_TOKEN tanımlı değil. Import yapılamaz.',
      'CONFIG_MISSING'
    )
  }

  if (!deps?.dryRun) {
    resolveTokenEncryptionKey({ requireExplicit: env.NODE_ENV === 'production' })
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, buroAdi: true, slug: true, aktifMi: true }
  })
  if (!tenant) {
    throw new AppError(404, 'Tenant bulunamadı.', 'TENANT_NOT_FOUND')
  }

  const conflict = await prisma.whatsAppBaglanti.findFirst({
    where: {
      phoneNumberId,
      NOT: { tenantId }
    },
    select: { tenantId: true }
  })
  if (conflict) {
    throw new AppError(
      409,
      'Bu WhatsApp numarası başka bir büroya bağlı.',
      'PHONE_NUMBER_CONFLICT'
    )
  }

  const verified = await verifyExistingWabaPhoneAssets({
    wabaId,
    phoneNumberId,
    accessToken,
    fetchImpl: deps?.fetchImpl
  })
  if (!verified.ok) {
    throw new AppError(502, verified.message, verified.code)
  }

  if (deps?.dryRun) {
    return {
      dryRun: true,
      verified: true,
      tenantId,
      tenantSlug: tenant.slug,
      wabaIdMasked: maskMetaId(verified.data.wabaId),
      phoneNumberIdMasked: maskMetaId(verified.data.phoneNumberId),
      displayPhoneNumber: verified.data.displayPhoneNumber,
      verifiedName: verified.data.verifiedName,
      phoneStatus: verified.data.phoneStatus,
      webhookOverrideWouldRun: false,
      cloudTestPhoneRequired: false,
      note: 'Read-only doğrulama; DB yazılmadı. Alıcı numarası production’da müvekkil telefonundan gelir.'
    }
  }

  await ensureTenantBildirimDefaults(tenantId)

  const encrypted = encryptSecret(accessToken)
  const now = new Date()
  const baglanti = await prisma.whatsAppBaglanti.update({
    where: { tenantId },
    data: {
      durum: WhatsAppBaglantiDurumu.BAGLI,
      provider: 'META_CLOUD',
      accessTokenEncrypted: encrypted,
      wabaId: verified.data.wabaId,
      phoneNumberId: verified.data.phoneNumberId,
      wabaIdMasked: maskMetaId(verified.data.wabaId),
      phoneNumberIdMasked: maskMetaId(verified.data.phoneNumberId),
      displayPhoneNumber: verified.data.displayPhoneNumber,
      verifiedName: verified.data.verifiedName,
      businessAccountName: verified.data.wabaName,
      tokenExpiresAt: null,
      // Paylaşılan WABA — Müvekkil Kasa webhook override YAPILMAZ
      webhookOverrideActive: false,
      webhookOverrideCallback: null,
      connectedAt: now,
      disconnectedAt: null,
      sonHataOzeti: null
    }
  })

  const meta = getRequestMeta(req)
  await writeAdminAuditLog({
    adminId,
    action: 'WHATSAPP_EXISTING_ASSET_IMPORTED',
    entityType: 'WhatsAppBaglanti',
    entityId: baglanti.id,
    newValue: {
      tenantId,
      tenantSlug: tenant.slug,
      wabaIdMasked: baglanti.wabaIdMasked,
      phoneNumberIdMasked: baglanti.phoneNumberIdMasked,
      webhookOverrideActive: false,
      sharedWebhookTestConnection: true
      // token asla yazılmaz
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getPublicConnectionStatus(baglanti)
}
