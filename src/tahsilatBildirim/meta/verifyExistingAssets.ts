import { graphFetch } from './graphClient.js'

export type VerifiedExistingAssets = {
  wabaId: string
  wabaName: string | null
  phoneNumberId: string
  displayPhoneNumber: string | null
  verifiedName: string | null
  phoneStatus: string | null
}

/**
 * Read-only Graph doğrulama: WABA erişilebilir + phone bu WABA’ya ait.
 * subscribed_apps / register / override çağrılmaz.
 */
export async function verifyExistingWabaPhoneAssets(opts: {
  wabaId: string
  phoneNumberId: string
  accessToken: string
  fetchImpl?: typeof fetch
}): Promise<
  | { ok: true; data: VerifiedExistingAssets }
  | { ok: false; code: string; message: string; errorSummary: string | null }
> {
  const wabaId = opts.wabaId.trim()
  const phoneNumberId = opts.phoneNumberId.trim()
  if (!wabaId || !phoneNumberId) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'wabaId ve phoneNumberId zorunludur.',
      errorSummary: null
    }
  }

  const waba = await graphFetch<{ id?: string; name?: string }>(encodeURIComponent(wabaId), {
    method: 'GET',
    accessToken: opts.accessToken,
    query: { fields: 'id,name' },
    fetchImpl: opts.fetchImpl
  })
  if (!waba.ok) {
    return {
      ok: false,
      code: 'WABA_UNREACHABLE',
      message: 'WABA System User token ile erişilemiyor.',
      errorSummary: waba.errorSummary
    }
  }

  const phones = await graphFetch<{
    data?: Array<{
      id?: string
      display_phone_number?: string
      verified_name?: string
      status?: string
    }>
  }>(`${encodeURIComponent(wabaId)}/phone_numbers`, {
    method: 'GET',
    accessToken: opts.accessToken,
    query: { fields: 'id,display_phone_number,verified_name,status', limit: '100' },
    fetchImpl: opts.fetchImpl
  })
  if (!phones.ok) {
    return {
      ok: false,
      code: 'PHONE_LIST_FAILED',
      message: 'WABA telefon listesi alınamadı (izin veya erişim hatası).',
      errorSummary: phones.errorSummary
    }
  }

  const match = (phones.data?.data ?? []).find((p) => String(p.id ?? '') === phoneNumberId)
  if (!match) {
    return {
      ok: false,
      code: 'PHONE_NOT_IN_WABA',
      message: 'Phone Number ID bu WABA’ya ait değil.',
      errorSummary: null
    }
  }

  const phoneDetail = await graphFetch<{
    id?: string
    display_phone_number?: string
    verified_name?: string
    status?: string
  }>(encodeURIComponent(phoneNumberId), {
    method: 'GET',
    accessToken: opts.accessToken,
    query: { fields: 'id,display_phone_number,verified_name,status' },
    fetchImpl: opts.fetchImpl
  })
  if (!phoneDetail.ok) {
    return {
      ok: false,
      code: 'PHONE_UNREACHABLE',
      message: 'Phone Number ID System User token ile okunamıyor.',
      errorSummary: phoneDetail.errorSummary
    }
  }

  const status = (phoneDetail.data?.status ?? match.status ?? '').trim().toUpperCase() || null
  // CONNECTED / CONNECTED_BUT_PENDING / PENDING — “aktif kullanılabilir” kabul; EMPTY reddet
  if (status === 'DELETED' || status === 'DISCONNECTED' || status === 'BANNED') {
    return {
      ok: false,
      code: 'PHONE_NOT_ACTIVE',
      message: `Telefon numarası aktif değil (status=${status}).`,
      errorSummary: null
    }
  }

  return {
    ok: true,
    data: {
      wabaId: waba.data?.id || wabaId,
      wabaName: waba.data?.name?.trim() || null,
      phoneNumberId: phoneDetail.data?.id || phoneNumberId,
      displayPhoneNumber:
        phoneDetail.data?.display_phone_number?.trim() ||
        match.display_phone_number?.trim() ||
        null,
      verifiedName:
        phoneDetail.data?.verified_name?.trim() || match.verified_name?.trim() || null,
      phoneStatus: status
    }
  }
}
