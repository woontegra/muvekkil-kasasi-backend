import {
  BildirimIsDurumu,
  BildirimKanali,
  Prisma,
  WhatsAppBaglantiDurumu
} from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import {
  env,
  resolveWhatsAppAppId,
  resolveWhatsAppGraphVersion
} from '../config/env.js'
import { decryptSecret, encryptSecret, resolveTokenEncryptionKey } from '../lib/secretCrypto.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  exchangeEmbeddedSignupCode,
  fetchPhoneNumberDetails,
  fetchWabaDetails,
  fetchWabaMessageTemplates,
  normalizeMetaTemplateStatus,
  registerPhoneNumberBestEffort
} from './meta/embeddedSignup.js'
import { applyWabaWebhookOverride } from './meta/wabaWebhookOverride.js'
import { graphFetch } from './meta/graphClient.js'
import { ensureTenantBildirimDefaults } from './settings.service.js'
import {
  getPublicConnectionStatus,
  isWhatsAppBaglantiConnected,
  maskMetaId
} from './connection.public.js'

export {
  getPublicConnectionStatus,
  isWhatsAppBaglantiConnected,
  maskMetaId
} from './connection.public.js'

export async function getConnectionDurum(tenantId: string): Promise<Record<string, unknown>> {
  await ensureTenantBildirimDefaults(tenantId)
  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  if (!baglanti) {
    return {
      durum: WhatsAppBaglantiDurumu.DISABLED,
      provider: 'META_CLOUD',
      connected: false,
      aktifProvider: 'MANUAL_WHATSAPP',
      cloudApiEnabled: env.WHATSAPP_CLOUD_API_ENABLED,
      gercekGonderimAktif: false
    }
  }
  return getPublicConnectionStatus(baglanti)
}

export function getEmbeddedSignupPublicConfig(): Record<string, unknown> {
  const appId = resolveWhatsAppAppId() ?? null
  const configId = env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ?? null
  return {
    appId,
    configId,
    graphVersion: resolveWhatsAppGraphVersion(),
    configured: Boolean(appId && configId && env.WHATSAPP_APP_SECRET)
  }
}

export type ConnectEmbeddedSignupInput = {
  code: string
  wabaId: string
  phoneNumberId: string
  pin?: string
}

/**
 * Embedded Signup tamamla: code exchange → kaydet → webhook override → phone register (best-effort).
 */
export async function connectEmbeddedSignup(
  tenantId: string,
  userId: string,
  input: ConnectEmbeddedSignupInput,
  req: Request,
  deps?: { fetchImpl?: typeof fetch }
): Promise<Record<string, unknown>> {
  if (!env.WHATSAPP_CLOUD_API_ENABLED) {
    throw new AppError(503, 'WhatsApp Cloud API özelliği kapalı.', 'FEATURE_DISABLED')
  }

  const code = input.code.trim()
  const wabaId = input.wabaId.trim()
  const phoneNumberId = input.phoneNumberId.trim()
  if (!code || !wabaId || !phoneNumberId) {
    throw new AppError(400, 'code, wabaId ve phoneNumberId zorunludur.', 'INVALID_INPUT')
  }

  // Production’da açık encryption key zorunlu
  resolveTokenEncryptionKey({ requireExplicit: env.NODE_ENV === 'production' })

  await ensureTenantBildirimDefaults(tenantId)

  // Conflict: aynı phone_number_id başka tenant’ta
  const conflict = await prisma.whatsAppBaglanti.findFirst({
    where: {
      phoneNumberId,
      NOT: { tenantId }
    },
    select: { tenantId: true, id: true }
  })
  if (conflict) {
    throw new AppError(
      409,
      'Bu WhatsApp numarası başka bir büroya bağlı.',
      'PHONE_NUMBER_CONFLICT'
    )
  }

  await prisma.whatsAppBaglanti.update({
    where: { tenantId },
    data: {
      durum: WhatsAppBaglantiDurumu.BAGLANIYOR,
      sonHataOzeti: null
    }
  })

  const exchange = await exchangeEmbeddedSignupCode(code, { fetchImpl: deps?.fetchImpl })
  if (!exchange.ok || !exchange.accessToken) {
    await prisma.whatsAppBaglanti.update({
      where: { tenantId },
      data: {
        durum: WhatsAppBaglantiDurumu.HATA,
        sonHataOzeti: exchange.errorSummary?.slice(0, 500) ?? 'Code exchange failed'
      }
    })
    throw new AppError(502, 'Meta Embedded Signup kodu doğrulanamadı.', 'CODE_EXCHANGE_FAILED')
  }

  const accessToken = exchange.accessToken
  const [phoneInfo, wabaInfo] = await Promise.all([
    fetchPhoneNumberDetails(phoneNumberId, accessToken, deps?.fetchImpl),
    fetchWabaDetails(wabaId, accessToken, deps?.fetchImpl)
  ])

  const encrypted = encryptSecret(accessToken)
  const tokenExpiresAt =
    exchange.expiresIn != null
      ? new Date(Date.now() + exchange.expiresIn * 1000)
      : null

  const override = await applyWabaWebhookOverride({
    wabaId,
    accessToken,
    fetchImpl: deps?.fetchImpl
  })

  // Phone register — best-effort; fail etmez
  await registerPhoneNumberBestEffort({
    phoneNumberId,
    accessToken,
    pin: input.pin,
    fetchImpl: deps?.fetchImpl
  })

  const now = new Date()
  const baglanti = await prisma.whatsAppBaglanti.update({
    where: { tenantId },
    data: {
      durum: WhatsAppBaglantiDurumu.BAGLI,
      provider: 'META_CLOUD',
      accessTokenEncrypted: encrypted,
      wabaId,
      phoneNumberId,
      wabaIdMasked: maskMetaId(wabaId),
      phoneNumberIdMasked: maskMetaId(phoneNumberId),
      displayPhoneNumber: phoneInfo.data?.displayPhoneNumber ?? null,
      verifiedName: phoneInfo.data?.verifiedName ?? null,
      businessAccountName: wabaInfo.data?.name ?? null,
      tokenExpiresAt,
      webhookOverrideActive: override.overrideVerified,
      webhookOverrideCallback: override.callbackUri,
      connectedAt: now,
      disconnectedAt: null,
      sonHataOzeti: override.ok
        ? null
        : `Webhook override uyarısı: ${(override.errorSummary ?? '').slice(0, 300)}`
    }
  })

  // Şablon senkron — best-effort
  try {
    await syncTemplates(tenantId, { fetchImpl: deps?.fetchImpl })
  } catch {
    // bağlanmayı bozma
  }

  const meta = getRequestMeta(req)
  await writeAuditLog({
    tenantId,
    userId,
    action: 'WHATSAPP_BAGLANTI_CONNECTED',
    entityType: 'WhatsAppBaglanti',
    entityId: baglanti.id,
    oldValue: null,
    newValue: {
      durum: baglanti.durum,
      wabaIdMasked: baglanti.wabaIdMasked,
      phoneNumberIdMasked: baglanti.phoneNumberIdMasked,
      webhookOverrideActive: baglanti.webhookOverrideActive
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getPublicConnectionStatus(baglanti)
}

export async function verifyConnection(
  tenantId: string,
  userId: string,
  req: Request,
  deps?: { fetchImpl?: typeof fetch }
): Promise<Record<string, unknown>> {
  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  if (!baglanti?.accessTokenEncrypted || !baglanti.phoneNumberId) {
    throw new AppError(400, 'WhatsApp bağlantısı bulunamadı.', 'WHATSAPP_NOT_CONNECTED')
  }

  let token: string
  try {
    token = decryptSecret(baglanti.accessTokenEncrypted)
  } catch {
    throw new AppError(500, 'Token çözülemedi.', 'TOKEN_DECRYPT_FAILED')
  }

  const phone = await fetchPhoneNumberDetails(
    baglanti.phoneNumberId,
    token,
    deps?.fetchImpl
  )

  if (!phone.ok) {
    await prisma.whatsAppBaglanti.update({
      where: { tenantId },
      data: {
        durum: WhatsAppBaglantiDurumu.HATA,
        sonHataOzeti: phone.errorSummary?.slice(0, 500) ?? 'Verify failed'
      }
    })
    throw new AppError(502, 'WhatsApp bağlantı doğrulaması başarısız.', 'VERIFY_FAILED')
  }

  const updated = await prisma.whatsAppBaglanti.update({
    where: { tenantId },
    data: {
      durum: WhatsAppBaglantiDurumu.BAGLI,
      displayPhoneNumber: phone.data?.displayPhoneNumber ?? baglanti.displayPhoneNumber,
      verifiedName: phone.data?.verifiedName ?? baglanti.verifiedName,
      sonHataOzeti: null
    }
  })

  const meta = getRequestMeta(req)
  await writeAuditLog({
    tenantId,
    userId,
    action: 'WHATSAPP_BAGLANTI_VERIFIED',
    entityType: 'WhatsAppBaglanti',
    entityId: updated.id,
    oldValue: null,
    newValue: { durum: updated.durum },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getPublicConnectionStatus(updated)
}

export async function syncTemplates(
  tenantId: string,
  deps?: { fetchImpl?: typeof fetch }
): Promise<{ synced: number; templates: Array<Record<string, unknown>> }> {
  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  if (!baglanti?.accessTokenEncrypted || !baglanti.wabaId) {
    throw new AppError(400, 'WhatsApp bağlantısı bulunamadı.', 'WHATSAPP_NOT_CONNECTED')
  }

  let token: string
  try {
    token = decryptSecret(baglanti.accessTokenEncrypted)
  } catch {
    throw new AppError(500, 'Token çözülemedi.', 'TOKEN_DECRYPT_FAILED')
  }

  const fetched = await fetchWabaMessageTemplates(baglanti.wabaId, token, deps?.fetchImpl)
  if (!fetched.ok) {
    throw new AppError(502, 'Meta şablonları alınamadı.', 'TEMPLATE_SYNC_FAILED')
  }

  const now = new Date()
  let synced = 0
  const out: Array<Record<string, unknown>> = []

  for (const t of fetched.templates) {
    const statusNormalized = normalizeMetaTemplateStatus(t.status)
    const row = await prisma.whatsAppMetaSablon.upsert({
      where: {
        tenantId_metaName_language: {
          tenantId,
          metaName: t.name,
          language: t.language
        }
      },
      create: {
        tenantId,
        baglantiId: baglanti.id,
        metaName: t.name,
        language: t.language,
        statusNormalized,
        category: t.category,
        lastSyncedAt: now
      },
      update: {
        baglantiId: baglanti.id,
        statusNormalized,
        category: t.category,
        lastSyncedAt: now
      }
    })
    synced += 1
    out.push({
      id: row.id,
      metaName: row.metaName,
      language: row.language,
      statusNormalized: row.statusNormalized,
      category: row.category,
      lastSyncedAt: row.lastSyncedAt.toISOString()
    })
  }

  return { synced, templates: out }
}

/**
 * Bağlantıyı kaldır: BAGLANTI_KESILDI, token temizle, PLANLANDI WhatsApp işlerini iptal et.
 */
export async function disconnectConnection(
  tenantId: string,
  userId: string,
  req: Request
): Promise<Record<string, unknown>> {
  await ensureTenantBildirimDefaults(tenantId)
  const now = new Date()

  const baglanti = await prisma.whatsAppBaglanti.update({
    where: { tenantId },
    data: {
      durum: WhatsAppBaglantiDurumu.BAGLANTI_KESILDI,
      accessTokenEncrypted: null,
      wabaId: null,
      phoneNumberId: null,
      wabaIdMasked: null,
      phoneNumberIdMasked: null,
      displayPhoneNumber: null,
      verifiedName: null,
      businessAccountName: null,
      tokenExpiresAt: null,
      webhookOverrideActive: false,
      webhookOverrideCallback: null,
      disconnectedAt: now,
      sonHataOzeti: null
    }
  })

  await prisma.tahsilatBildirimIsi.updateMany({
    where: {
      tenantId,
      kanal: BildirimKanali.WHATSAPP,
      durum: { in: [BildirimIsDurumu.PLANLANDI, BildirimIsDurumu.KUYRUKTA] }
    },
    data: {
      durum: BildirimIsDurumu.IPTAL_EDILDI,
      iptalNedeni: 'WhatsApp bağlantısı kaldırıldı',
      lockedAt: null,
      lockedBy: null
    }
  })

  const meta = getRequestMeta(req)
  await writeAuditLog({
    tenantId,
    userId,
    action: 'WHATSAPP_BAGLANTI_DISCONNECTED',
    entityType: 'WhatsAppBaglanti',
    entityId: baglanti.id,
    oldValue: null,
    newValue: { durum: baglanti.durum },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getPublicConnectionStatus(baglanti)
}

/** Tenant send için çözülmüş Cloud kimlik bilgileri (token loglanmaz). */
export async function loadTenantCloudCredentials(tenantId: string): Promise<{
  ok: true
  phoneNumberId: string
  accessToken: string
  baglantiId: string
} | {
  ok: false
  code: string
  message: string
}> {
  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  if (!baglanti || !isWhatsAppBaglantiConnected(baglanti.durum)) {
    return {
      ok: false,
      code: 'WHATSAPP_NOT_CONNECTED',
      message: 'WhatsApp Cloud API bağlantısı yok veya aktif değil.'
    }
  }
  if (!baglanti.accessTokenEncrypted || !baglanti.phoneNumberId) {
    return {
      ok: false,
      code: 'WHATSAPP_NOT_CONNECTED',
      message: 'WhatsApp Cloud API kimlik bilgileri eksik.'
    }
  }
  try {
    const accessToken = decryptSecret(baglanti.accessTokenEncrypted)
    return {
      ok: true,
      phoneNumberId: baglanti.phoneNumberId,
      accessToken,
      baglantiId: baglanti.id
    }
  } catch {
    return {
      ok: false,
      code: 'TOKEN_DECRYPT_FAILED',
      message: 'WhatsApp token çözülemedi.'
    }
  }
}

/** Tenant’ın onaylı Meta şablonu var mı? */
export async function hasApprovedMetaTemplate(
  tenantId: string,
  metaName?: string | null
): Promise<boolean> {
  const where: Prisma.WhatsAppMetaSablonWhereInput = {
    tenantId,
    statusNormalized: 'ONAYLANDI',
    ...(metaName?.trim() ? { metaName: metaName.trim() } : {})
  }
  const count = await prisma.whatsAppMetaSablon.count({ where })
  return count > 0
}

/** Platform smoke test — yalnızca global env (tenant send değil). */
export async function platformSmokeSend(opts: {
  toE164: string
  text?: string
  templateName?: string
  templateLanguage?: string
  fetchImpl?: typeof fetch
}): Promise<{ ok: boolean; code: string; message: string; providerMessageId?: string | null }> {
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID
  const token = env.WHATSAPP_ACCESS_TOKEN
  if (!phoneNumberId || !token) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      message: 'Platform smoke credential eksik.'
    }
  }

  const to = opts.toE164.replace(/\D/g, '')
  const useTemplate = Boolean(opts.templateName?.trim())
  const body: Record<string, unknown> = useTemplate
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: opts.templateName!.trim(),
          language: { code: (opts.templateLanguage || 'en_US').slice(0, 16) }
        }
      }
    : {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { preview_url: false, body: (opts.text || 'smoke').slice(0, 4096) }
      }

  const result = await graphFetch<{ messages?: Array<{ id?: string }> }>(
    `${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: 'POST',
      accessToken: token,
      body,
      fetchImpl: opts.fetchImpl
    }
  )

  if (!result.ok) {
    return {
      ok: false,
      code: result.errorCode != null ? `META_${result.errorCode}` : 'SEND_FAILED',
      message: 'Platform smoke gönderimi başarısız.'
    }
  }

  return {
    ok: true,
    code: 'SENT',
    message: 'Platform smoke gönderildi.',
    providerMessageId: result.data?.messages?.[0]?.id ?? null
  }
}
