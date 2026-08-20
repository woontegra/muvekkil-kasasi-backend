import { resolveWhatsAppGraphVersion } from '../../config/env.js'

export type SafeMetaGraphError = {
  httpStatus: number
  code: number | null
  type: string | null
  error_subcode: number | null
  error_user_title: string | null
  error_user_msg: string | null
  details: string | null
  message: string | null
  fbtrace_id: string | null
}

export type GraphRequestResult<T = unknown> = {
  ok: boolean
  httpStatus: number
  data: T | null
  errorSummary: string | null
  errorCode: number | null
  errorDetails: SafeMetaGraphError | null
}

type MetaErrorBody = {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    error_user_title?: string
    error_user_msg?: string
    fbtrace_id?: string
    error_data?: {
      details?: string
      [key: string]: unknown
    }
  }
}

export function graphVersion(): string {
  return resolveWhatsAppGraphVersion()
}

export function graphBaseUrl(version?: string): string {
  return `https://graph.facebook.com/${version ?? graphVersion()}`
}

function clip(value: unknown, max: number): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  return s.slice(0, max)
}

/** Token / secret loglanmaz. */
export function sanitizeGraphError(body: MetaErrorBody | null, httpStatus: number): {
  errorSummary: string
  errorCode: number | null
  errorDetails: SafeMetaGraphError
} {
  const err = body?.error
  const metaCode = typeof err?.code === 'number' ? err.code : null
  const details = clip(err?.error_data?.details, 400)
  const errorDetails: SafeMetaGraphError = {
    httpStatus,
    code: metaCode,
    type: clip(err?.type, 80),
    error_subcode: typeof err?.error_subcode === 'number' ? err.error_subcode : null,
    error_user_title: clip(err?.error_user_title, 160),
    error_user_msg: clip(err?.error_user_msg, 400),
    details,
    message: clip(err?.message, 400),
    fbtrace_id: clip(err?.fbtrace_id, 64)
  }
  return {
    errorCode: metaCode,
    errorDetails,
    errorSummary: JSON.stringify(errorDetails)
  }
}

/** Kullanıcıya güvenli Meta create hata metni. */
export function formatSafeMetaCreateErrorMessage(
  details: SafeMetaGraphError | null | undefined,
  accountName: string
): string {
  const account = accountName.trim() || 'bağlı WhatsApp hesabı'
  if (!details) {
    return `Şablon Meta hesabında oluşturulamadı. Lütfen bağlantıyı kontrol edip tekrar deneyin. Hedef hesap: ${account}.`
  }
  const explanation =
    details.error_user_msg || details.details || details.error_user_title || details.message
  const codePart =
    details.code != null
      ? ` Meta kodu: ${details.code}${details.error_subcode != null ? `, alt kod: ${details.error_subcode}` : ''}.`
      : ''
  const supportPart = details.fbtrace_id ? ` Destek kodu: ${details.fbtrace_id}.` : ''
  if (explanation) {
    return `Şablon Meta hesabında oluşturulamadı: ${explanation}.${codePart}${supportPart} Hedef hesap: ${account}.`
  }
  return `Şablon Meta hesabında oluşturulamadı. Lütfen bağlantıyı kontrol edip tekrar deneyin.${codePart}${supportPart} Hedef hesap: ${account}.`
}

export type GraphFetchOptions = {
  method?: 'GET' | 'POST' | 'DELETE'
  accessToken?: string
  /** Query string params (token hariç). */
  query?: Record<string, string | undefined | null>
  /** JSON body — empty object için {}. Body yoksa undefined. */
  body?: unknown
  /** Boş body ile POST (subscribed_apps adım 1). */
  emptyBody?: boolean
  version?: string
  /** Testlerde inject edilebilir. */
  fetchImpl?: typeof fetch
}

/**
 * Versioned Graph API isteği. Authorization Bearer kullanılır; token loglanmaz.
 */
export async function graphFetch<T = unknown>(
  path: string,
  opts: GraphFetchOptions = {}
): Promise<GraphRequestResult<T>> {
  const fetchFn = opts.fetchImpl ?? fetch
  const version = opts.version ?? graphVersion()
  const cleanPath = path.replace(/^\/+/, '')
  const url = new URL(`${graphBaseUrl(version)}/${cleanPath}`)
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== '') url.searchParams.set(k, v)
    }
  }

  const headers: Record<string, string> = {}
  if (opts.accessToken) {
    headers.Authorization = `Bearer ${opts.accessToken}`
  }

  const method = opts.method ?? 'GET'
  let body: string | undefined
  if (opts.emptyBody) {
    body = undefined
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  let httpStatus = 0
  let rawText = ''
  try {
    const res = await fetchFn(url.toString(), { method, headers, body })
    httpStatus = res.status
    rawText = await res.text()
  } catch (e) {
    const errorDetails: SafeMetaGraphError = {
      httpStatus: 0,
      code: null,
      type: null,
      error_subcode: null,
      error_user_title: null,
      error_user_msg: null,
      details: null,
      message: e instanceof Error ? e.message.slice(0, 200) : 'network_error',
      fbtrace_id: null
    }
    return {
      ok: false,
      httpStatus: 0,
      data: null,
      errorCode: null,
      errorDetails,
      errorSummary: JSON.stringify({ network: true, message: errorDetails.message })
    }
  }

  let parsed: (T & MetaErrorBody) | MetaErrorBody = {}
  try {
    parsed = rawText ? (JSON.parse(rawText) as T & MetaErrorBody) : ({} as T & MetaErrorBody)
  } catch {
    const errorDetails: SafeMetaGraphError = {
      httpStatus,
      code: null,
      type: null,
      error_subcode: null,
      error_user_title: null,
      error_user_msg: null,
      details: null,
      message: 'parseError',
      fbtrace_id: null
    }
    return {
      ok: false,
      httpStatus,
      data: null,
      errorCode: null,
      errorDetails,
      errorSummary: JSON.stringify({ httpStatus, parseError: true })
    }
  }

  const asErr = parsed as MetaErrorBody
  if (httpStatus < 200 || httpStatus >= 300 || asErr.error) {
    const sanitized = sanitizeGraphError(asErr, httpStatus)
    return {
      ok: false,
      httpStatus,
      data: null,
      errorCode: sanitized.errorCode,
      errorDetails: sanitized.errorDetails,
      errorSummary: sanitized.errorSummary
    }
  }

  return {
    ok: true,
    httpStatus,
    data: parsed as T,
    errorCode: null,
    errorDetails: null,
    errorSummary: null
  }
}
