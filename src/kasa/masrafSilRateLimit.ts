/**
 * Masraf güvenli silme — başarısız şifre denemeleri (tenant+user+IP).
 * 15 dk içinde 5 başarısız denemeden sonra geçici engel.
 */

export const MASRAF_SIL_FAIL_WINDOW_MS = 15 * 60 * 1000
export const MASRAF_SIL_MAX_FAILURES = 5

type Bucket = { failures: number[]; blockedUntil: number }

const buckets = new Map<string, Bucket>()

export function masrafSilAttemptKey(tenantId: string, userId: string, ip: string | null | undefined): string {
  return `${tenantId}:${userId}:${ip?.trim() || 'no-ip'}`
}

function prune(now: number, b: Bucket): void {
  const cut = now - MASRAF_SIL_FAIL_WINDOW_MS
  b.failures = b.failures.filter((t) => t > cut)
  if (b.blockedUntil > 0 && b.blockedUntil <= now) {
    b.blockedUntil = 0
  }
}

export function clearMasrafSilFailuresForTests(): void {
  buckets.clear()
}

export function isMasrafSilVerificationBlocked(key: string, now = Date.now()): boolean {
  const b = buckets.get(key)
  if (!b) return false
  prune(now, b)
  return b.blockedUntil > now
}

export function assertMasrafSilVerificationAllowed(key: string, now = Date.now()): void {
  if (isMasrafSilVerificationBlocked(key, now)) {
    const err = new Error('MASRAF_SIL_RATE_LIMITED')
    ;(err as Error & { code: string }).code = 'MASRAF_SIL_RATE_LIMITED'
    throw err
  }
}

/** Başarısız şifre — engel oluşursa true. */
export function recordMasrafSilPasswordFailure(key: string, now = Date.now()): boolean {
  let b = buckets.get(key)
  if (!b) {
    b = { failures: [], blockedUntil: 0 }
    buckets.set(key, b)
  }
  prune(now, b)
  if (b.blockedUntil > now) return true
  b.failures.push(now)
  if (b.failures.length >= MASRAF_SIL_MAX_FAILURES) {
    b.blockedUntil = now + MASRAF_SIL_FAIL_WINDOW_MS
    return true
  }
  return false
}

export function clearMasrafSilPasswordFailures(key: string): void {
  buckets.delete(key)
}
