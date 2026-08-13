import { resolveWhatsAppGraphVersion } from '../../config/env.js'

export type GraphRequestResult<T = unknown> = {
  ok: boolean
  httpStatus: number
  data: T | null
  errorSummary: string | null
  errorCode: number | null
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
  }
}

export function graphVersion(): string {
  return resolveWhatsAppGraphVersion()
}

export function graphBaseUrl(version?: string): string {
  return `https://graph.facebook.com/${version ?? graphVersion()}`
}

/** Token / secret loglanmaz. */
export function sanitizeGraphError(body: MetaErrorBody | null, httpStatus: number): {
  errorSummary: string
  errorCode: number | null
} {
  const err = body?.error
  const metaCode = typeof err?.code === 'number' ? err.code : null
  return {
    errorCode: metaCode,
    errorSummary: JSON.stringify({
      httpStatus,
      code: metaCode,
      type: err?.type ?? null,
      error_subcode: err?.error_subcode ?? null,
      error_user_title: (err?.error_user_title ?? '').slice(0, 120) || null,
      message: (err?.message ?? '').slice(0, 240) || null,
      fbtrace_id: err?.fbtrace_id ?? null
    })
  }
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
    return {
      ok: false,
      httpStatus: 0,
      data: null,
      errorCode: null,
      errorSummary: JSON.stringify({
        network: true,
        message: e instanceof Error ? e.message.slice(0, 200) : 'network_error'
      })
    }
  }

  let parsed: (T & MetaErrorBody) | MetaErrorBody = {}
  try {
    parsed = rawText ? (JSON.parse(rawText) as T & MetaErrorBody) : ({} as T & MetaErrorBody)
  } catch {
    return {
      ok: false,
      httpStatus,
      data: null,
      errorCode: null,
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
      errorSummary: sanitized.errorSummary
    }
  }

  return {
    ok: true,
    httpStatus,
    data: parsed as T,
    errorCode: null,
    errorSummary: null
  }
}
