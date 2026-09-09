/**
 * Platform Admin WhatsApp operasyon bildirimi — paket talebi.
 * Tenant mesaj kredisi / consumeForJob / worker kullanmaz.
 * Gönderen: ADMIN_NOTIFICATION_WHATSAPP_TENANT_ID → WhatsAppBaglanti (loadTenantCloudCredentials).
 * Serbest text fallback YOK (24s dışı Cloud API kuralı).
 */
import { env } from '../config/env.js'
import { getAdminWhatsAppPaketTalepleriUrl } from '../mail/mail.config.js'
import {
  formatSafeMetaSendErrorMessage,
  graphFetch,
  graphVersion
} from './meta/graphClient.js'
import { loadTenantCloudCredentials } from './connection.service.js'

export const ADMIN_PAKET_TALEP_WA_TEMPLATE_DEFAULT = 'mk_admin_paket_talebi_v1' as const

export type AdminWhatsAppPaketTalepWaParams = {
  buroAdi: string
  /** Talep eden tenant (alıcı/gönderen DEĞİL — yalnızca içerik/audit). */
  requestingTenantId: string
  packageId: string
  paketLabel: string
  mesajAdedi: number
  fiyatTL: number
}

export type AdminWhatsAppPaketTalepWaResult = {
  sent: boolean
  attempted: boolean
  skipped?: boolean
  error?: string
  code?: string
  toMasked?: string
  senderTenantId?: string | null
  templateName?: string
  providerMessageId?: string | null
  reviewUrl?: string
}

function optionalTrim(v: string | undefined | null): string | undefined {
  const t = v?.trim()
  return t ? t : undefined
}

function maskPhone(e164OrDigits: string): string {
  const d = e164OrDigits.replace(/\D/g, '')
  if (d.length < 6) return '***'
  return `+${d.slice(0, 4)}***${d.slice(-2)}`
}

/** E.164 (+ ile) veya salt rakam → Graph `to` (digits). */
export function normalizeAdminNotificationWhatsAppTo(
  raw: string | undefined | null
): { ok: true; toDigits: string; e164Display: string } | { ok: false; error: string } {
  const trimmed = optionalTrim(raw)
  if (!trimmed) return { ok: false, error: 'admin_whatsapp_recipient_missing' }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) {
    return { ok: false, error: 'admin_whatsapp_recipient_invalid_e164' }
  }
  // E.164 beklenir; + yoksa da digits kabul (config esnekliği).
  return { ok: true, toDigits: digits, e164Display: `+${digits}` }
}

export function getAdminNotificationWhatsAppRecipient(): string | null {
  return optionalTrim(env.ADMIN_NOTIFICATION_WHATSAPP) ?? null
}

export function getAdminNotificationWhatsAppSenderTenantId(): string | null {
  return optionalTrim(env.ADMIN_NOTIFICATION_WHATSAPP_TENANT_ID) ?? null
}

export function getAdminNotificationWhatsAppTemplateName(): string {
  return (
    optionalTrim(env.ADMIN_NOTIFICATION_WHATSAPP_TEMPLATE_NAME) ??
    ADMIN_PAKET_TALEP_WA_TEMPLATE_DEFAULT
  )
}

export function getAdminNotificationWhatsAppTemplateLang(): string {
  return optionalTrim(env.ADMIN_NOTIFICATION_WHATSAPP_TEMPLATE_LANG) ?? 'tr'
}

/**
 * Meta UTILITY template body parametreleri:
 * {{1}} büro {{2}} mesaj adedi {{3}} tutar {{4}} durum
 */
export function buildAdminPaketTalepWaTemplateComponents(params: {
  buroAdi: string
  mesajAdedi: number
  fiyatTL: number
}): Array<Record<string, unknown>> {
  const adet = params.mesajAdedi.toLocaleString('tr-TR')
  const tutar = `${params.fiyatTL.toLocaleString('tr-TR')} TL`
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: params.buroAdi.slice(0, 1024) },
        { type: 'text', text: adet.slice(0, 1024) },
        { type: 'text', text: tutar.slice(0, 1024) },
        { type: 'text', text: 'Bekliyor' }
      ]
    }
  ]
}

/**
 * Admin ops WhatsApp template gönderimi.
 * consumeForJob ÇAĞIRMAZ. Serbest text göndermez.
 */
export async function sendAdminWhatsAppPaketTalepWhatsApp(
  params: AdminWhatsAppPaketTalepWaParams,
  deps?: { fetchImpl?: typeof fetch; toOverride?: string; senderTenantIdOverride?: string }
): Promise<AdminWhatsAppPaketTalepWaResult> {
  const reviewUrl = getAdminWhatsAppPaketTalepleriUrl()
  const templateName = getAdminNotificationWhatsAppTemplateName()
  const templateLang = getAdminNotificationWhatsAppTemplateLang()

  const toRaw = deps?.toOverride ?? getAdminNotificationWhatsAppRecipient()
  const toNorm = normalizeAdminNotificationWhatsAppTo(toRaw)
  if (!toNorm.ok) {
    // eslint-disable-next-line no-console
    console.warn('[wa-admin-notify] skip —', toNorm.error)
    return {
      sent: false,
      attempted: false,
      skipped: true,
      error: toNorm.error,
      code: toNorm.error,
      templateName,
      reviewUrl
    }
  }
  const toMasked = maskPhone(toNorm.toDigits)

  const senderTenantId =
    deps?.senderTenantIdOverride?.trim() || getAdminNotificationWhatsAppSenderTenantId()
  if (!senderTenantId) {
    // eslint-disable-next-line no-console
    console.warn('[wa-admin-notify] skip — ADMIN_NOTIFICATION_WHATSAPP_TENANT_ID missing')
    return {
      sent: false,
      attempted: false,
      skipped: true,
      error: 'admin_whatsapp_sender_tenant_missing',
      code: 'admin_whatsapp_sender_tenant_missing',
      toMasked,
      senderTenantId: null,
      templateName,
      reviewUrl
    }
  }

  if (!env.WHATSAPP_CLOUD_API_ENABLED) {
    // eslint-disable-next-line no-console
    console.warn('[wa-admin-notify] skip — WHATSAPP_CLOUD_API_ENABLED=false')
    return {
      sent: false,
      attempted: false,
      skipped: true,
      error: 'whatsapp_cloud_api_disabled',
      code: 'FEATURE_DISABLED',
      toMasked,
      senderTenantId,
      templateName,
      reviewUrl
    }
  }

  const creds = await loadTenantCloudCredentials(senderTenantId)
  if (!creds.ok) {
    // eslint-disable-next-line no-console
    console.error('[wa-admin-notify] sender credentials failed —', creds.code)
    return {
      sent: false,
      attempted: true,
      error: creds.message,
      code: creds.code,
      toMasked,
      senderTenantId,
      templateName,
      reviewUrl
    }
  }

  const components = buildAdminPaketTalepWaTemplateComponents({
    buroAdi: params.buroAdi,
    mesajAdedi: params.mesajAdedi,
    fiyatTL: params.fiyatTL
  })

  // eslint-disable-next-line no-console
  console.info('[wa-admin-notify] attempt — to:', toMasked, 'template:', templateName, 'senderTenant:', senderTenantId)

  const body = {
    messaging_product: 'whatsapp',
    to: toNorm.toDigits,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLang.slice(0, 16) },
      components
    }
  }

  const result = await graphFetch<{ messages?: Array<{ id?: string }> }>(
    `${encodeURIComponent(creds.phoneNumberId)}/messages`,
    {
      method: 'POST',
      accessToken: creds.accessToken,
      body,
      version: graphVersion(),
      fetchImpl: deps?.fetchImpl
    }
  )

  if (!result.ok) {
    const msg = formatSafeMetaSendErrorMessage(result.errorDetails).slice(0, 500)
    // eslint-disable-next-line no-console
    console.error('[wa-admin-notify] FAILED —', result.errorCode ?? result.httpStatus, msg)
    return {
      sent: false,
      attempted: true,
      error: msg,
      code: result.errorCode != null ? `META_${result.errorCode}` : `HTTP_${result.httpStatus}`,
      toMasked,
      senderTenantId,
      templateName,
      providerMessageId: null,
      reviewUrl
    }
  }

  const providerMessageId = result.data?.messages?.[0]?.id?.trim() || null
  if (!providerMessageId) {
    return {
      sent: false,
      attempted: true,
      error: 'Meta API message id dönmedi',
      code: 'NO_MESSAGE_ID',
      toMasked,
      senderTenantId,
      templateName,
      providerMessageId: null,
      reviewUrl
    }
  }

  // eslint-disable-next-line no-console
  console.info('[wa-admin-notify] sent — to:', toMasked, 'mid:', providerMessageId)
  return {
    sent: true,
    attempted: true,
    toMasked,
    senderTenantId,
    templateName,
    providerMessageId,
    reviewUrl
  }
}
