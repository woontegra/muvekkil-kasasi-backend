import { env } from '../../config/env.js'
import { graphFetch, type GraphRequestResult } from './graphClient.js'

export type WebhookOverrideResult = {
  ok: boolean
  subscribed: boolean
  overrideApplied: boolean
  overrideVerified: boolean
  callbackUri: string | null
  errorSummary: string | null
  errorCode: number | null
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
      errorSummary: JSON.stringify({
        code: 'WEBHOOK_OVERRIDE_CONFIG_MISSING',
        message: 'WHATSAPP_WEBHOOK_PUBLIC_URL veya WHATSAPP_WEBHOOK_VERIFY_TOKEN eksik.'
      }),
      errorCode: null
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
      errorSummary: step1.errorSummary,
      errorCode: step1.errorCode
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
      errorSummary: step2.errorSummary,
      errorCode: step2.errorCode
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

  return {
    ok: verified,
    subscribed: true,
    overrideApplied: true,
    overrideVerified: verified,
    callbackUri,
    errorSummary: verified
      ? null
      : step3.errorSummary ??
        JSON.stringify({
          code: 'OVERRIDE_NOT_VERIFIED',
          message: 'subscribed_apps yanıtında override_callback_uri doğrulanamadı.'
        }),
    errorCode: verified ? null : step3.errorCode
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
