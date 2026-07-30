import { env } from '../../config/env.js'

export type SmsSendPayload = {
  tenantId: string
  to: string
  text: string
  idempotencyKey: string
}

export type SmsNormalizedErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'INVALID_ORIGINATOR'
  | 'INVALID_PHONE'
  | 'INSUFFICIENT_PROVIDER_BALANCE'
  | 'DUPLICATE_LIMIT'
  | 'TEMPORARY_PROVIDER_ERROR'
  | 'INVALID_REQUEST'
  | 'UNKNOWN'

export type SmsSendResult = {
  ok: boolean
  provider: 'NETGSM' | 'MOCK'
  providerMessageId?: string | null
  providerBulkId?: string | null
  code: string
  message: string
  normalizedError?: SmsNormalizedErrorCode
  retryable?: boolean
}

export type SmsReportResult = {
  ok: boolean
  provider: 'NETGSM' | 'MOCK'
  status: 'BEKLIYOR' | 'TESLIM_EDILDI' | 'BASARISIZ'
  code?: string
  message?: string
  retryable?: boolean
}

export interface SmsProvider {
  send(payload: SmsSendPayload): Promise<SmsSendResult>
  getSendResult(bulkId: string): Promise<SmsReportResult>
  queryReport(bulkId: string): Promise<SmsReportResult>
  checkConnection(): Promise<{ ok: boolean; mode: 'NOT_CONFIGURED' | 'TEST' | 'CONNECTED' | 'ERROR'; message: string }>
}

function mapNetgsmError(code: string): Pick<SmsSendResult, 'normalizedError' | 'retryable' | 'message'> {
  switch (code) {
    case '30':
      return { normalizedError: 'INVALID_CREDENTIALS', retryable: false, message: 'Netgsm kimlik bilgileri geçersiz.' }
    case '40':
      return { normalizedError: 'INVALID_ORIGINATOR', retryable: false, message: 'Gönderici başlığı geçersiz.' }
    case '45':
      return { normalizedError: 'INVALID_PHONE', retryable: false, message: 'Telefon numarası geçersiz.' }
    case '70':
      return { normalizedError: 'INVALID_REQUEST', retryable: false, message: 'Netgsm istek parametreleri geçersiz.' }
    case '80':
      return { normalizedError: 'TEMPORARY_PROVIDER_ERROR', retryable: true, message: 'Netgsm gönderim limiti aşıldı.' }
    case '85':
      return { normalizedError: 'DUPLICATE_LIMIT', retryable: false, message: 'Kısa sürede mükerrer gönderim limiti aşıldı.' }
    default:
      return { normalizedError: 'UNKNOWN', retryable: true, message: 'Netgsm geçici olarak yanıt vermiyor.' }
  }
}

export class MockSmsProvider implements SmsProvider {
  async send(_payload: SmsSendPayload): Promise<SmsSendResult> {
    return {
      ok: true,
      provider: 'MOCK',
      code: 'SIMULATED',
      message: 'Test modu: gerçek SMS gönderimi yapılmadı.',
      providerBulkId: `mock-${Date.now()}`
    }
  }
  async getSendResult(_bulkId: string): Promise<SmsReportResult> {
    return { ok: true, provider: 'MOCK', status: 'TESLIM_EDILDI', code: 'SIMULATED' }
  }
  async queryReport(_bulkId: string): Promise<SmsReportResult> {
    return { ok: true, provider: 'MOCK', status: 'TESLIM_EDILDI', code: 'SIMULATED' }
  }
  async checkConnection(): Promise<{ ok: boolean; mode: 'NOT_CONFIGURED' | 'TEST' | 'CONNECTED' | 'ERROR'; message: string }> {
    return { ok: true, mode: 'TEST', message: 'Mock provider aktif.' }
  }
}

export class NetgsmSmsProvider implements SmsProvider {
  private readonly baseUrl = 'https://api.netgsm.com.tr'

  async send(payload: SmsSendPayload): Promise<SmsSendResult> {
    if (!env.NETGSM_USERNAME || !env.NETGSM_PASSWORD || !env.NETGSM_ORIGINATOR) {
      return {
        ok: false,
        provider: 'NETGSM',
        code: 'NOT_CONFIGURED',
        message: 'Netgsm yapılandırması eksik.',
        normalizedError: 'INVALID_CREDENTIALS',
        retryable: false
      }
    }

    const response = await fetch(`${this.baseUrl}/sms/rest/v2/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgheader: env.NETGSM_ORIGINATOR,
        messages: [{ msg: payload.text, no: payload.to }],
        encoding: 'TR',
        iysfilter: '0',
        appname: 'muvekkil-kasa-saas'
      })
    })

    const data = (await response.json().catch(() => ({}))) as
      | { code?: string; description?: string; jobs?: Array<{ jobid?: string }> }
      | undefined
    const code = data?.code ?? String(response.status)
    if (code === '00' && Array.isArray(data?.jobs) && data.jobs[0]?.jobid) {
      return {
        ok: true,
        provider: 'NETGSM',
        code,
        message: 'SMS kabul edildi.',
        providerBulkId: data.jobs[0].jobid
      }
    }
    const mapped = mapNetgsmError(code)
    return {
      ok: false,
      provider: 'NETGSM',
      code,
      message: mapped.message,
      normalizedError: mapped.normalizedError,
      retryable: mapped.retryable
    }
  }

  async getSendResult(bulkId: string): Promise<SmsReportResult> {
    return this.queryReport(bulkId)
  }

  async queryReport(bulkId: string): Promise<SmsReportResult> {
    if (!env.NETGSM_USERNAME || !env.NETGSM_PASSWORD) {
      return { ok: false, provider: 'NETGSM', status: 'BEKLIYOR', code: 'NOT_CONFIGURED', message: 'Eksik yapılandırma.' }
    }
    const url = new URL(`${this.baseUrl}/sms/report`)
    url.searchParams.set('usercode', env.NETGSM_USERNAME)
    url.searchParams.set('password', env.NETGSM_PASSWORD)
    url.searchParams.set('bulkid', bulkId)
    url.searchParams.set('type', '0')
    url.searchParams.set('status', '100')
    url.searchParams.set('version', '2')

    const response = await fetch(url.toString(), { method: 'GET' })
    const data = (await response.json().catch(() => ({}))) as { code?: string; jobs?: Array<{ status?: number }> }
    const code = data?.code ?? String(response.status)
    if (code !== '00' || !Array.isArray(data?.jobs) || data.jobs.length === 0) {
      const mapped = mapNetgsmError(code)
      return {
        ok: false,
        provider: 'NETGSM',
        status: 'BEKLIYOR',
        code,
        message: mapped.message,
        retryable: mapped.retryable
      }
    }
    const status = data.jobs[0]?.status
    if (status === 1) return { ok: true, provider: 'NETGSM', status: 'TESLIM_EDILDI', code: '1' }
    if ([2, 3, 4, 11, 12, 13, 15, 16, 17, 103].includes(Number(status))) {
      return { ok: false, provider: 'NETGSM', status: 'BASARISIZ', code: String(status), message: 'Netgsm teslim raporu başarısız.' }
    }
    return { ok: true, provider: 'NETGSM', status: 'BEKLIYOR', code: String(status ?? 0) }
  }

  async checkConnection(): Promise<{ ok: boolean; mode: 'NOT_CONFIGURED' | 'TEST' | 'CONNECTED' | 'ERROR'; message: string }> {
    if (!env.NETGSM_ENABLED) return { ok: true, mode: 'TEST', message: 'NETGSM_ENABLED=false (test modu).' }
    if (!env.NETGSM_USERNAME || !env.NETGSM_PASSWORD || !env.NETGSM_ORIGINATOR) {
      return { ok: false, mode: 'NOT_CONFIGURED', message: 'Netgsm ayarları eksik.' }
    }
    const response = await fetch(`${this.baseUrl}/balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usercode: env.NETGSM_USERNAME,
        password: env.NETGSM_PASSWORD,
        stip: 2
      })
    })
    const data = (await response.json().catch(() => ({}))) as { code?: string }
    if (response.ok && data?.code === '00') return { ok: true, mode: 'CONNECTED', message: 'Netgsm bağlantısı doğrulandı.' }
    return { ok: false, mode: 'ERROR', message: 'Netgsm bağlantısı doğrulanamadı.' }
  }
}

export function getSmsProvider(testModu: boolean): SmsProvider {
  if (testModu || !env.NETGSM_ENABLED) return new MockSmsProvider()
  return new NetgsmSmsProvider()
}
