import { env } from '../../config/env.js'
import {
  graphFetch,
  type GraphRequestResult,
  type SafeMetaGraphError
} from './graphClient.js'

export type WebhookOverrideFailedStep =
  | 'STEP_1_SUBSCRIBE'
  | 'STEP_2_OVERRIDE'
  | 'STEP_3_VERIFY'

export type WebhookOverrideResult = {
  ok: boolean
  subscribed: boolean
  overrideApplied: boolean
  overrideVerified: boolean
  callbackUri: string | null
  failedStep: WebhookOverrideFailedStep | null
  errorSummary: string | null
  errorCode: number | null
  errorDetails: SafeMetaGraphError | null
}

type SubscribedAppsResponse = {
  data?: Array<{
    id?: string
    name?: string
    link?: string
    override_callback_uri?: string
  }>
}

/**
 * Meta WABA webhook override — İKİ ADIM (docs):
 * 1) POST /{WABA_ID}/subscribed_apps  (boş body — önce subscribe)
 * 2) POST /{WABA_ID}/subscribed_apps  JSON { override_callback_uri, verify_token }
 * 3) GET  /{WABA_ID}/subscribed_apps  — override_callback_uri doğrula
 */
export async function applyWabaWebhookOverride(opts: {
  wabaId: string
  accessToken: string
  callbackUri?: string
  verifyToken?: string
  fetchImpl?: typeof fetch
}): Promise<WebhookOverrideResult> {
  const callbackUri =
    opts.callbackUri?.trim() || env.WHATSAPP_WEBHOOK_PUBLIC_URL?.trim() || null
  const verifyToken =
    opts.verifyToken?.trim() || env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || null

  if (!callbackUri || !verifyToken) {
    return {
      ok: false,
      subscribed: false,
      overrideApplied: false,
      overrideVerified: false,
      callbackUri,
      failedStep: null,
      errorSummary: JSON.stringify({
        code: 'WEBHOOK_OVERRIDE_CONFIG_MISSING',
        message: 'WHATSAPP_WEBHOOK_PUBLIC_URL veya WHATSAPP_WEBHOOK_VERIFY_TOKEN eksik.'
      }),
      errorCode: null,
      errorDetails: null
    }
  }

  const path = `${encodeURIComponent(opts.wabaId)}/subscribed_apps`
  const common = { accessToken: opts.accessToken, fetchImpl: opts.fetchImpl }

  // Adım 1: boş POST — app subscribe
  const step1 = await graphFetch(path, {
    ...common,
    method: 'POST',
    emptyBody: true
  })
  if (!step1.ok) {
    return {
      ok: false,
      subscribed: false,
      overrideApplied: false,
      overrideVerified: false,
      callbackUri,
      failedStep: 'STEP_1_SUBSCRIBE',
      errorSummary: step1.errorSummary,
      errorCode: step1.errorCode,
      errorDetails: step1.errorDetails
    }
  }

  // Adım 2: override
  const step2 = await graphFetch(path, {
    ...common,
    method: 'POST',
    body: {
      override_callback_uri: callbackUri,
      verify_token: verifyToken
    }
  })
  if (!step2.ok) {
    return {
      ok: false,
      subscribed: true,
      overrideApplied: false,
      overrideVerified: false,
      callbackUri,
      failedStep: 'STEP_2_OVERRIDE',
      errorSummary: step2.errorSummary,
      errorCode: step2.errorCode,
      errorDetails: step2.errorDetails
    }
  }

  // Adım 3: GET verify
  const step3 = await graphFetch<SubscribedAppsResponse>(path, {
    ...common,
    method: 'GET'
  })
  const verified = Boolean(
    step3.ok &&
      step3.data?.data?.some(
        (app) =>
          typeof app.override_callback_uri === 'string' &&
          app.override_callback_uri.trim() === callbackUri
      )
  )

  if (verified) {
    return {
      ok: true,
      subscribed: true,
      overrideApplied: true,
      overrideVerified: true,
      callbackUri,
      failedStep: null,
      errorSummary: null,
      errorCode: null,
      errorDetails: null
    }
  }

  const verifySummary =
    step3.errorSummary ??
    JSON.stringify({
      code: 'OVERRIDE_NOT_VERIFIED',
      message: 'subscribed_apps yanıtında override_callback_uri doğrulanamadı.'
    })

  return {
    ok: false,
    subscribed: true,
    overrideApplied: true,
    overrideVerified: false,
    callbackUri,
    failedStep: 'STEP_3_VERIFY',
    errorSummary: verifySummary,
    errorCode: step3.errorCode,
    errorDetails: step3.errorDetails ?? {
      httpStatus: step3.httpStatus,
      code: null,
      type: null,
      error_subcode: null,
      error_user_title: null,
      error_user_msg: null,
      details: null,
      message: 'subscribed_apps yanıtında override_callback_uri doğrulanamadı.',
      fbtrace_id: null
    }
  }
}

export async function getSubscribedApps(
  wabaId: string,
  accessToken: string,
  fetchImpl?: typeof fetch
): Promise<GraphRequestResult<SubscribedAppsResponse>> {
  return graphFetch<SubscribedAppsResponse>(`${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: 'GET',
    accessToken,
    fetchImpl
  })
}

/** GET subscribed_apps yanıtından ilk dolu override_callback_uri. */
export function extractOverrideCallbackUri(
  data: SubscribedAppsResponse | null | undefined
): string | null {
  for (const app of data?.data ?? []) {
    const uri = app.override_callback_uri?.trim()
    if (uri) return uri
  }
  return null
}

/**
 * WABA alternate callback silme (Meta docs — “Delete WABA alternate callback”):
 * POST /{WABA_ID}/subscribed_apps  body olmadan (boş subscribe).
 * DELETE subscribed_apps kullanılmaz (uygulamayı WABA’dan tamamen çıkarır).
 * App Dashboard global callback’e dokunulmaz; override kalkınca event’ler App callback’ine döner.
 */
export async function clearWabaWebhookOverride(opts: {
  wabaId: string
  accessToken: string
  fetchImpl?: typeof fetch
}): Promise<WebhookOverrideResult> {
  const path = `${encodeURIComponent(opts.wabaId)}/subscribed_apps`
  const common = { accessToken: opts.accessToken, fetchImpl: opts.fetchImpl }

  const step1 = await graphFetch(path, {
    ...common,
    method: 'POST',
    emptyBody: true
  })
  if (!step1.ok) {
    return {
      ok: false,
      subscribed: false,
      overrideApplied: false,
      overrideVerified: false,
      callbackUri: null,
      failedStep: 'STEP_1_SUBSCRIBE',
      errorSummary: step1.errorSummary,
      errorCode: step1.errorCode,
      errorDetails: step1.errorDetails
    }
  }

  const step2 = await graphFetch<SubscribedAppsResponse>(path, {
    ...common,
    method: 'GET'
  })
  const remaining = extractOverrideCallbackUri(step2.data)
  const cleared = step2.ok && remaining == null

  return {
    ok: cleared,
    subscribed: true,
    overrideApplied: false,
    overrideVerified: cleared,
    callbackUri: remaining,
    failedStep: cleared ? null : 'STEP_3_VERIFY',
    errorSummary: cleared
      ? null
      : step2.errorSummary ??
        JSON.stringify({
          code: 'OVERRIDE_STILL_PRESENT',
          message: 'Boş subscribe sonrası override_callback_uri hâlâ dolu.'
        }),
    errorCode: cleared ? null : step2.errorCode,
    errorDetails: cleared
      ? null
      : step2.errorDetails ?? {
          httpStatus: step2.httpStatus,
          code: null,
          type: null,
          error_subcode: null,
          error_user_title: null,
          error_user_msg: null,
          details: null,
          message: 'Boş subscribe sonrası override_callback_uri hâlâ dolu.',
          fbtrace_id: null
        }
  }
}

/** SUPER_ADMIN teşhisi — token/secret içermez. */
export function buildWebhookOverrideFailureDetails(result: WebhookOverrideResult): {
  failedStep: WebhookOverrideFailedStep | null
  httpStatus: number | null
  code: number | null
  error_subcode: number | null
  type: string | null
  message: string | null
  error_user_title: string | null
  error_user_msg: string | null
  errorSummary: string | null
} {
  const d = result.errorDetails
  return {
    failedStep: result.failedStep,
    httpStatus: d?.httpStatus ?? null,
    code: d?.code ?? result.errorCode ?? null,
    error_subcode: d?.error_subcode ?? null,
    type: d?.type ?? null,
    message: d?.message ?? null,
    error_user_title: d?.error_user_title ?? null,
    error_user_msg: d?.error_user_msg ?? null,
    errorSummary: result.errorSummary
  }
}
