export type WhatsAppSendPayload = {
  tenantId: string
  /** E.164 without +: 90XXXXXXXXXX — çağıran taraf loglamamalı. */
  toE164: string
  text: string
  idempotencyKey: string
}

export type WhatsAppSendResult = {
  ok: boolean
  provider: string
  code: string
  message: string
  externalId?: string | null
}

export interface WhatsAppProvider {
  send(payload: WhatsAppSendPayload): Promise<WhatsAppSendResult>
}

/** Faz 1: ağ çağrısı yok; başarılı simülasyon. */
export class MockWhatsAppProvider implements WhatsAppProvider {
  async send(_payload: WhatsAppSendPayload): Promise<WhatsAppSendResult> {
    return {
      ok: true,
      provider: 'MOCK_SIMULATION',
      code: 'SIMULATED',
      message: 'Simülasyon başarılı; gerçek WhatsApp gönderimi yapılmadı.',
      externalId: null
    }
  }
}

/** Faz 1: Meta Cloud API kapalı — sahte başarı yok. */
export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  async send(_payload: WhatsAppSendPayload): Promise<WhatsAppSendResult> {
    return {
      ok: false,
      provider: 'META_CLOUD',
      code: 'DISABLED',
      message: 'WhatsApp otomatik gönderimi henüz aktif değil',
      externalId: null
    }
  }
}

export function getWhatsAppProvider(testModu: boolean): WhatsAppProvider {
  if (testModu) return new MockWhatsAppProvider()
  return new MetaCloudWhatsAppProvider()
}
