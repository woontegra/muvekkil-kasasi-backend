import { isValidKullaniciAdi, normalizeKullaniciAdi } from '../../lib/normalizeKullaniciAdi.js'
import type { WoontegraWebsiteProvisionBody } from './woontegraWebsiteProvision.schemas.js'

const FALLBACK_PREFIX = 'owner'
const MAX_USERNAME_LEN = 64
const USERNAME_ATTEMPTS = 3

export function resolveOwnerUsernamePrefix(email: string, customerName: string): string {
  const emailLocal = email.split('@')[0] ?? ''
  let base = normalizeKullaniciAdi(emailLocal)
  if (!isValidKullaniciAdi(base)) {
    base = normalizeKullaniciAdi(customerName)
  }
  if (!isValidKullaniciAdi(base)) {
    return FALLBACK_PREFIX
  }
  return base
}

export function buildStableUsernameSuffix(
  externalCustomerId: string | null | undefined,
  externalOrderId: string,
  attempt: number,
): string {
  const compactCustomer = (externalCustomerId ?? '').replace(/-/g, '').toLowerCase()
  if (compactCustomer.length >= 4) {
    if (attempt === 0) return compactCustomer.slice(0, 6)
    if (attempt === 1) return `${compactCustomer.slice(0, 4)}${compactCustomer.slice(-2)}`
    return `${compactCustomer.slice(0, 3)}${attempt}${compactCustomer.slice(6, 8)}`
  }

  const orderNo = (externalOrderId.split(':')[0] ?? externalOrderId).trim()
  const digits = orderNo.replace(/\D/g, '')
  const orderCompact = normalizeKullaniciAdi(orderNo.replace(/^wnt-/i, 'wnt').replace(/-/g, ''))

  if (attempt === 0) {
    const fromDigits = digits.slice(-6).padStart(6, '0')
    return fromDigits.slice(0, 6)
  }
  if (attempt === 1) {
    const fromOrder = orderCompact.slice(-6).padStart(6, '0')
    return fromOrder.slice(0, 6)
  }
  const mixed = `${digits.slice(-4)}a${attempt}`
  return mixed.slice(0, 6).padEnd(6, '0')
}

export function buildOwnerUsernameCandidate(prefix: string, suffix: string): string {
  const safeSuffix = suffix.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12)
  const maxPrefixLen = Math.max(3, MAX_USERNAME_LEN - 1 - safeSuffix.length)
  const safePrefix = prefix.slice(0, maxPrefixLen)
  const username = `${safePrefix}_${safeSuffix}`.slice(0, MAX_USERNAME_LEN)
  if (isValidKullaniciAdi(username)) return username

  const fallback = `${FALLBACK_PREFIX}_${safeSuffix}`.slice(0, MAX_USERNAME_LEN)
  if (isValidKullaniciAdi(fallback)) return fallback

  return `${FALLBACK_PREFIX}_${safeSuffix.slice(0, 6)}`.slice(0, MAX_USERNAME_LEN)
}

export function buildOwnerUsernameCandidates(body: WoontegraWebsiteProvisionBody): string[] {
  const prefix = resolveOwnerUsernamePrefix(body.customer.email, body.customer.name)
  const candidates: string[] = []
  for (let attempt = 0; attempt < USERNAME_ATTEMPTS; attempt++) {
    const suffix = buildStableUsernameSuffix(body.externalCustomerId, body.externalOrderId, attempt)
    candidates.push(buildOwnerUsernameCandidate(prefix, suffix))
  }
  return candidates
}

export { USERNAME_ATTEMPTS }
