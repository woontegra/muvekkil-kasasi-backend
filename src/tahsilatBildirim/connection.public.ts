import { WhatsAppBaglantiDurumu } from '@prisma/client'
import { env } from '../config/env.js'
import { maskPhone } from './phone.js'

const CONNECTED_STATUSES: WhatsAppBaglantiDurumu[] = [
  WhatsAppBaglantiDurumu.BAGLI,
  WhatsAppBaglantiDurumu.ACTIVE
]

/** Meta id / phone_number_id görüntü maskesi — son 4 görünür. */
export function maskMetaId(id: string | null | undefined): string | null {
  if (!id) return null
  const s = id.trim()
  if (s.length <= 4) return '••••'
  return `${'•'.repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`
}

export function isWhatsAppBaglantiConnected(
  durum: WhatsAppBaglantiDurumu | null | undefined
): boolean {
  return durum != null && CONNECTED_STATUSES.includes(durum)
}

export function getPublicConnectionStatus(baglanti: {
  durum: WhatsAppBaglantiDurumu
  provider: string
  wabaIdMasked: string | null
  phoneNumberIdMasked: string | null
  displayPhoneNumber: string | null
  verifiedName: string | null
  businessAccountName: string | null
  webhookOverrideActive: boolean
  webhookOverrideCallback: string | null
  connectedAt: Date | null
  disconnectedAt: Date | null
  lastWebhookAt: Date | null
  tokenExpiresAt: Date | null
  sonHataOzeti: string | null
}): Record<string, unknown> {
  const connected = isWhatsAppBaglantiConnected(baglanti.durum)
  return {
    durum: baglanti.durum,
    provider: baglanti.provider,
    connected,
    wabaIdMasked: baglanti.wabaIdMasked,
    phoneNumberIdMasked: baglanti.phoneNumberIdMasked,
    displayPhoneNumber: baglanti.displayPhoneNumber
      ? maskPhone(baglanti.displayPhoneNumber)
      : null,
    verifiedName: baglanti.verifiedName,
    businessAccountName: baglanti.businessAccountName,
    webhookOverrideActive: baglanti.webhookOverrideActive,
    webhookOverrideCallback: baglanti.webhookOverrideCallback,
    connectedAt: baglanti.connectedAt?.toISOString() ?? null,
    disconnectedAt: baglanti.disconnectedAt?.toISOString() ?? null,
    lastWebhookAt: baglanti.lastWebhookAt?.toISOString() ?? null,
    tokenExpiresAt: baglanti.tokenExpiresAt?.toISOString() ?? null,
    sonHataOzeti: baglanti.sonHataOzeti,
    cloudApiEnabled: env.WHATSAPP_CLOUD_API_ENABLED,
    aktifProvider: connected ? 'WHATSAPP_CLOUD_API' : 'MANUAL_WHATSAPP',
    gercekGonderimAktif: connected && env.WHATSAPP_CLOUD_API_ENABLED,
    /** BAGLI + override yok → paylaşılan/test bağlantısı (import yolu). */
    sharedWebhookTestConnection: connected && !baglanti.webhookOverrideActive
  }
}
