import { env } from '../../config/env.js'

export type WhatsAppProviderKind = 'MANUAL_WHATSAPP' | 'WHATSAPP_CLOUD_API'

export type WhatsAppSendPayload = {
  tenantId: string
  /** E.164 without +: 90XXXXXXXXXX — çağıran taraf loglamamalı. */
  toE164: string
  text: string
  idempotencyKey: string
}

export type WhatsAppSendResult = {
  ok: boolean
  provider: WhatsAppProviderKind | 'MOCK_SIMULATION'
  code: string
  message: string
  providerMessageId?: string | null
  /** Yalnızca MANUAL_WHATSAPP: kullanıcı yönlendirme URL’si. */
  deepLinkUrl?: string | null
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
      deepLinkUrl
    }
  }
}

/**
 * Meta Cloud API iskeleti.
 * WHATSAPP_CLOUD_API_ENABLED=false veya hesap ACTIVE değilken gerçek dış istek yok.
 */
export class WhatsAppCloudApiProvider implements WhatsAppProvider {
  readonly kind = 'WHATSAPP_CLOUD_API' as const

  async send(_payload: WhatsAppSendPayload): Promise<WhatsAppSendResult> {
    if (!env.WHATSAPP_CLOUD_API_ENABLED) {
      return {
        ok: false,
        provider: 'WHATSAPP_CLOUD_API',
        code: 'FEATURE_DISABLED',
        message: 'WhatsApp Cloud API feature flag kapalı; gerçek gönderim yapılmaz.',
        providerMessageId: null
      }
    }
    // Meta onayı ve tenant secret/config tamamlanmadan ağ çağrısı yok.
    return {
      ok: false,
      provider: 'WHATSAPP_CLOUD_API',
      code: 'NOT_CONFIGURED',
      message: 'WhatsApp Cloud API henüz yapılandırılmadı; Meta onayı sonrası aktif edilecek.',
      providerMessageId: null
    }
  }
}

export function isWhatsAppCloudApiAllowed(): boolean {
  return env.WHATSAPP_CLOUD_API_ENABLED === true
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
