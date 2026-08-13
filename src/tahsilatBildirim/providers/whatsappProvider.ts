import { env } from '../../config/env.js'
import { graphFetch, graphVersion } from '../meta/graphClient.js'
import { loadTenantCloudCredentials } from '../connection.service.js'

/** Canlı varsayılan: MANUAL_WHATSAPP. Meta WhatsApp onayı sonrası WHATSAPP_CLOUD_API yeniden etkinleştirilecek. */
export type WhatsAppProviderKind = 'MANUAL_WHATSAPP' | 'WHATSAPP_CLOUD_API'

export type WhatsAppSendPayload = {
  tenantId: string
  /** E.164 without +: 90XXXXXXXXXX — çağıran taraf loglamamalı. */
  toE164: string
  text: string
  idempotencyKey: string
  /**
   * Opsiyonel Meta template. Doluysa serbest metin yerine template gönderilir
   * (24s dışı soğuk mesaj / bağlantı testi için).
   */
  templateName?: string | null
  templateLanguage?: string | null
}

export type WhatsAppSendResult = {
  ok: boolean
  provider: WhatsAppProviderKind | 'MOCK_SIMULATION'
  code: string
  message: string
  providerMessageId?: string | null
  /** Yalnızca MANUAL_WHATSAPP: kullanıcı yönlendirme URL’si. */
  deepLinkUrl?: string | null
  httpStatus?: number | null
  metaErrorCode?: number | null
  /** Secret içermeyen Meta hata özeti. */
  metaErrorSummary?: string | null
  usedTemplate?: boolean
  templateName?: string | null
}

export interface WhatsAppProvider {
  readonly kind: WhatsAppProviderKind
  send(payload: WhatsAppSendPayload): Promise<WhatsAppSendResult>
}

/** Kullanıcı kendi WhatsApp hesabından gönderir; API çağrısı yok. */
export class ManualWhatsAppProvider implements WhatsAppProvider {
  readonly kind = 'MANUAL_WHATSAPP' as const

  async send(payload: WhatsAppSendPayload): Promise<WhatsAppSendResult> {
    const deepLinkUrl = `https://wa.me/${payload.toE164}?text=${encodeURIComponent(payload.text)}`
    return {
      ok: true,
      provider: 'MANUAL_WHATSAPP',
      code: 'MANUAL_READY',
      message: 'WhatsApp bağlantısı hazır; mesaj otomatik gönderilmez.',
      providerMessageId: null,
      deepLinkUrl,
      usedTemplate: false
    }
  }
}

/**
 * Meta Cloud API provider — tenant WhatsAppBaglanti token + phoneNumberId kullanır.
 * Global env token tenant gönderiminde KULLANILMAZ.
 */
export class WhatsAppCloudApiProvider implements WhatsAppProvider {
  readonly kind = 'WHATSAPP_CLOUD_API' as const

  async send(payload: WhatsAppSendPayload): Promise<WhatsAppSendResult> {
    if (!env.WHATSAPP_CLOUD_API_ENABLED) {
      return {
        ok: false,
        provider: 'WHATSAPP_CLOUD_API',
        code: 'FEATURE_DISABLED',
        message: 'WhatsApp Cloud API feature flag kapalı; gerçek gönderim yapılmaz.',
        providerMessageId: null,
        usedTemplate: false
      }
    }

    const creds = await loadTenantCloudCredentials(payload.tenantId)
    if (!creds.ok) {
      return {
        ok: false,
        provider: 'WHATSAPP_CLOUD_API',
        code: creds.code,
        message: creds.message,
        providerMessageId: null,
        usedTemplate: false
      }
    }

    const to = payload.toE164.replace(/\D/g, '')
    if (!to || to.length < 10) {
      return {
        ok: false,
        provider: 'WHATSAPP_CLOUD_API',
        code: 'INVALID_PHONE',
        message: 'Geçersiz alıcı telefon numarası.',
        providerMessageId: null,
        usedTemplate: false
      }
    }

    const templateName = payload.templateName?.trim() || null
    const useTemplate = Boolean(templateName)
    const language = (payload.templateLanguage?.trim() || 'en_US').slice(0, 16)

    const body: Record<string, unknown> = useTemplate
      ? {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: language }
          }
        }
      : {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { preview_url: false, body: payload.text.slice(0, 4096) }
        }

    const result = await graphFetch<{ messages?: Array<{ id?: string }> }>(
      `${encodeURIComponent(creds.phoneNumberId)}/messages`,
      {
        method: 'POST',
        accessToken: creds.accessToken,
        body,
        version: graphVersion()
      }
    )

    if (!result.ok) {
      return {
        ok: false,
        provider: 'WHATSAPP_CLOUD_API',
        code: result.errorCode != null ? `META_${result.errorCode}` : `HTTP_${result.httpStatus}`,
        message: 'Meta WhatsApp API hatası.',
        providerMessageId: null,
        httpStatus: result.httpStatus || null,
        metaErrorCode: result.errorCode,
        metaErrorSummary: result.errorSummary,
        usedTemplate: useTemplate,
        templateName
      }
    }

    const messageId = result.data?.messages?.[0]?.id?.trim() || null
    if (!messageId) {
      return {
        ok: false,
        provider: 'WHATSAPP_CLOUD_API',
        code: 'NO_MESSAGE_ID',
        message: 'Meta API başarı döndü ancak message id yok.',
        providerMessageId: null,
        httpStatus: result.httpStatus,
        usedTemplate: useTemplate,
        templateName
      }
    }

    return {
      ok: true,
      provider: 'WHATSAPP_CLOUD_API',
      code: 'SENT',
      message: useTemplate
        ? `Template mesajı gönderildi (${templateName}).`
        : 'Metin mesajı gönderildi.',
      providerMessageId: messageId,
      httpStatus: result.httpStatus,
      usedTemplate: useTemplate,
      templateName
    }
  }
}

export function isWhatsAppCloudApiAllowed(): boolean {
  return env.WHATSAPP_CLOUD_API_ENABLED === true
}

/** @deprecated Tenant için baglanti kontrolü kullanın; platform smoke için env. */
export function isWhatsAppCloudApiConfigured(): boolean {
  return Boolean(env.WHATSAPP_PHONE_NUMBER_ID?.trim() && env.WHATSAPP_ACCESS_TOKEN?.trim())
}

/**
 * Varsayılan: MANUAL_WHATSAPP.
 * Cloud API yalnızca feature flag açıkken seçilebilir; aksi halde manuel.
 */
export function resolveWhatsAppProvider(preferred?: WhatsAppProviderKind | null): WhatsAppProvider {
  if (preferred === 'WHATSAPP_CLOUD_API' && isWhatsAppCloudApiAllowed()) {
    return new WhatsAppCloudApiProvider()
  }
  return new ManualWhatsAppProvider()
}

export function getWhatsAppProvider(testModu: boolean): WhatsAppProvider {
  // testModu eski çağrılar için; Cloud API flag kapalıysa her zaman manuel.
  if (testModu || !isWhatsAppCloudApiAllowed()) {
    return new ManualWhatsAppProvider()
  }
  return new WhatsAppCloudApiProvider()
}
