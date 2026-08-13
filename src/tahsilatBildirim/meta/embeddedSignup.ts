import { env, resolveWhatsAppAppId } from '../../config/env.js'
import { graphFetch, graphVersion } from './graphClient.js'

export type EmbeddedSignupExchangeResult = {
  ok: boolean
  accessToken: string | null
  expiresIn: number | null
  tokenType: string | null
  errorSummary: string | null
  errorCode: number | null
}

export type PhoneNumberDetails = {
  id: string
  displayPhoneNumber: string | null
  verifiedName: string | null
}

export type WabaDetails = {
  id: string
  name: string | null
}

export type MetaTemplateRow = {
  name: string
  language: string
  status: string
  category: string | null
}

/**
 * Embedded Signup: FB.login config_id → code.
 * Backend: GET /{version}/oauth/access_token?client_id=&client_secret=&code=
 * Popup SDK akışında redirect_uri boş string gerekebilir.
 */
export async function exchangeEmbeddedSignupCode(
  code: string,
  opts?: { redirectUri?: string; fetchImpl?: typeof fetch }
): Promise<EmbeddedSignupExchangeResult> {
  const clientId = resolveWhatsAppAppId()
  const clientSecret = env.WHATSAPP_APP_SECRET
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      accessToken: null,
      expiresIn: null,
      tokenType: null,
      errorSummary: JSON.stringify({
        code: 'APP_CREDENTIALS_MISSING',
        message: 'WHATSAPP_APP_ID / WHATSAPP_APP_SECRET eksik.'
      }),
      errorCode: null
    }
  }

  const redirectUri = opts?.redirectUri ?? ''
  const result = await graphFetch<{
    access_token?: string
    token_type?: string
    expires_in?: number
  }>('oauth/access_token', {
    method: 'GET',
    query: {
      client_id: clientId,
      client_secret: clientSecret,
      code: code.trim(),
      // Popup SDK: boş redirect_uri
      redirect_uri: redirectUri
    },
    fetchImpl: opts?.fetchImpl,
    version: graphVersion()
  })

  if (!result.ok || !result.data?.access_token) {
    return {
      ok: false,
      accessToken: null,
      expiresIn: null,
      tokenType: null,
      errorSummary: result.errorSummary,
      errorCode: result.errorCode
    }
  }

  return {
    ok: true,
    accessToken: result.data.access_token,
    expiresIn: typeof result.data.expires_in === 'number' ? result.data.expires_in : null,
    tokenType: result.data.token_type ?? null,
    errorSummary: null,
    errorCode: null
  }
}

export async function fetchPhoneNumberDetails(
  phoneNumberId: string,
  accessToken: string,
  fetchImpl?: typeof fetch
): Promise<{ ok: boolean; data: PhoneNumberDetails | null; errorSummary: string | null }> {
  const result = await graphFetch<{
    id?: string
    display_phone_number?: string
    verified_name?: string
  }>(encodeURIComponent(phoneNumberId), {
    method: 'GET',
    accessToken,
    query: { fields: 'id,display_phone_number,verified_name' },
    fetchImpl
  })
  if (!result.ok) {
    return { ok: false, data: null, errorSummary: result.errorSummary }
  }
  return {
    ok: true,
    data: {
      id: result.data?.id || phoneNumberId,
      displayPhoneNumber: result.data?.display_phone_number?.trim() || null,
      verifiedName: result.data?.verified_name?.trim() || null
    },
    errorSummary: null
  }
}

export async function fetchWabaDetails(
  wabaId: string,
  accessToken: string,
  fetchImpl?: typeof fetch
): Promise<{ ok: boolean; data: WabaDetails | null; errorSummary: string | null }> {
  const result = await graphFetch<{ id?: string; name?: string }>(encodeURIComponent(wabaId), {
    method: 'GET',
    accessToken,
    query: { fields: 'id,name' },
    fetchImpl
  })
  if (!result.ok) {
    return { ok: false, data: null, errorSummary: result.errorSummary }
  }
  return {
    ok: true,
    data: {
      id: result.data?.id || wabaId,
      name: result.data?.name?.trim() || null
    },
    errorSummary: null
  }
}

/**
 * Telefon kaydı — best-effort.
 * Zaten kayıtlıysa tüm connect akışını bozmaz.
 */
export async function registerPhoneNumberBestEffort(opts: {
  phoneNumberId: string
  accessToken: string
  pin?: string
  fetchImpl?: typeof fetch
}): Promise<{ attempted: boolean; ok: boolean; alreadyRegistered: boolean; errorSummary: string | null }> {
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp'
  }
  if (opts.pin?.trim()) {
    body.pin = opts.pin.trim()
  }

  const result = await graphFetch(`${encodeURIComponent(opts.phoneNumberId)}/register`, {
    method: 'POST',
    accessToken: opts.accessToken,
    body,
    fetchImpl: opts.fetchImpl
  })

  if (result.ok) {
    return { attempted: true, ok: true, alreadyRegistered: false, errorSummary: null }
  }

  // Meta: already registered / invalid pin vs. already done — soft fail
  const summary = result.errorSummary ?? ''
  const already =
    summary.includes('133010') ||
    summary.toLowerCase().includes('already') ||
    result.errorCode === 100

  return {
    attempted: true,
    ok: false,
    alreadyRegistered: already,
    errorSummary: result.errorSummary
  }
}

export function normalizeMetaTemplateStatus(raw: string | undefined | null): string {
  const s = (raw ?? '').trim().toUpperCase()
  switch (s) {
    case 'APPROVED':
      return 'ONAYLANDI'
    case 'PENDING':
    case 'IN_APPEAL':
      return 'BEKLIYOR'
    case 'REJECTED':
      return 'REDDEDILDI'
    case 'PAUSED':
      return 'DURAKLATILDI'
    case 'DISABLED':
    case 'DELETED':
      return 'DEVRE_DISI'
    default:
      return s || 'BEKLIYOR'
  }
}

export async function fetchWabaMessageTemplates(
  wabaId: string,
  accessToken: string,
  fetchImpl?: typeof fetch
): Promise<{ ok: boolean; templates: MetaTemplateRow[]; errorSummary: string | null }> {
  const result = await graphFetch<{
    data?: Array<{
      name?: string
      language?: string
      status?: string
      category?: string
    }>
  }>(`${encodeURIComponent(wabaId)}/message_templates`, {
    method: 'GET',
    accessToken,
    query: { fields: 'name,language,status,category', limit: '100' },
    fetchImpl
  })

  if (!result.ok) {
    return { ok: false, templates: [], errorSummary: result.errorSummary }
  }

  const templates: MetaTemplateRow[] = (result.data?.data ?? [])
    .filter((t) => t.name && t.language)
    .map((t) => ({
      name: t.name!,
      language: t.language!,
      status: t.status ?? 'PENDING',
      category: t.category ?? null
    }))

  return { ok: true, templates, errorSummary: null }
}
