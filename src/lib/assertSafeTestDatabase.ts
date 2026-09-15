/**
 * Write E2E / quality script koruması — production DB’ye yazmayı engeller.
 * Unit/mock testler bu kapıyı çağırmaz.
 */
export class TestDatabaseBlockedError extends Error {
  readonly code = 'TEST_DB_BLOCKED'
  constructor(message: string) {
    super(message)
    this.name = 'TestDatabaseBlockedError'
  }
}

export class MessagingTestBlockedError extends Error {
  readonly code = 'MESSAGING_TEST_BLOCKED'
  constructor(message: string) {
    super(message)
    this.name = 'MessagingTestBlockedError'
  }
}

const PROD_HOST_RE =
  /(?:^|[./@])(?:rlwy\.net|railway\.app|railway\.internal|proxy\.rlwy\.net)(?:[:/]|$)/i

function parseDbUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

export function isProductionDatabaseUrl(url: string | undefined | null): boolean {
  const raw = (url ?? '').trim()
  if (!raw) return false
  const u = parseDbUrl(raw)
  if (!u) {
    return PROD_HOST_RE.test(raw) || /(?:^|[/?&])(?:database|dbname)=railway(?:&|$)/i.test(raw)
  }
  const host = u.hostname.toLowerCase()
  if (PROD_HOST_RE.test(host) || host.endsWith('.rlwy.net') || host.includes('railway')) {
    return true
  }
  const dbName = (u.pathname.replace(/^\//, '').split('?')[0] || '').toLowerCase()
  if (dbName === 'railway') return true
  if (/[?&](?:database|dbname)=railway(?:&|$)/i.test(u.search)) return true
  return false
}

export function isProductionApiUrl(url: string | undefined | null): boolean {
  const raw = (url ?? '').trim()
  if (!raw) return false
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase()
    return (
      host.includes('railway.app') ||
      host.includes('rlwy.net') ||
      host === 'muvekkil.woontegra.com' ||
      host.endsWith('.up.railway.app')
    )
  } catch {
    return /railway\.app|rlwy\.net|muvekkil\.woontegra\.com/i.test(raw)
  }
}

export function isMessagingMockMode(): boolean {
  const keys = [
    process.env.MESSAGING_TEST_MODE,
    process.env.SMS_PROVIDER,
    process.env.WHATSAPP_PROVIDER,
    process.env.WHATSAPP_TEST_MODE
  ]
  return keys.some((v) => (v ?? '').trim().toLowerCase() === 'mock')
}

export function isRealExternalMessagingExplicitlyAllowed(): boolean {
  return process.env.ALLOW_REAL_EXTERNAL_MESSAGING?.trim() === 'YES'
}

/**
 * WhatsApp/SMS write testleri: mock provider zorunlu.
 * Gerçek gönderim yalnız ALLOW_REAL_EXTERNAL_MESSAGING=YES ile (bilinçli oneshot).
 */
export function assertSafeMessagingTest(opts?: {
  /** true → ALLOW_REAL_EXTERNAL_MESSAGING=YES yeterli (mock gerekmez) */
  allowRealWithExplicitFlag?: boolean
}): void {
  if (opts?.allowRealWithExplicitFlag && isRealExternalMessagingExplicitlyAllowed()) {
    return
  }
  if (isMessagingMockMode()) return
  throw new MessagingTestBlockedError(
    'BLOCKED: messaging write test requires MESSAGING_TEST_MODE=mock (or SMS_PROVIDER/WHATSAPP_PROVIDER=mock); real send needs ALLOW_REAL_EXTERNAL_MESSAGING=YES'
  )
}

/**
 * Write quality/E2E script girişi.
 * - Yalnız `TEST_DATABASE_URL` ile çalışır (DATABASE_URL yetmez).
 * - Production host / db adı `railway` → sert blok.
 * - Production API hedefi → sert blok.
 * - `NODE_ENV=test` tek başına yeterli değildir.
 */
export function assertSafeTestDatabase(opts?: {
  /** API tabanlı scriptlerde kontrol edilecek URL (E2E_API_URL vb.) */
  apiUrl?: string | null
}): void {
  const testUrl = process.env.TEST_DATABASE_URL?.trim()
  if (!testUrl) {
    throw new TestDatabaseBlockedError(
      'BLOCKED: isolated TEST_DATABASE_URL required'
    )
  }
  if (isProductionDatabaseUrl(testUrl)) {
    throw new TestDatabaseBlockedError(
      'BLOCKED: TEST_DATABASE_URL points to production (rlwy/railway host or database name "railway")'
    )
  }

  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (databaseUrl && isProductionDatabaseUrl(databaseUrl)) {
    throw new TestDatabaseBlockedError(
      'BLOCKED: DATABASE_URL points to production; write tests must not run against it'
    )
  }

  const apiCandidates = [
    opts?.apiUrl,
    process.env.E2E_API_URL,
    process.env.PROD_API_URL,
    process.env.TEST_BASE_URL,
    process.env.API_BASE_URL
  ]
  for (const api of apiCandidates) {
    if (api && isProductionApiUrl(api)) {
      throw new TestDatabaseBlockedError(
        'BLOCKED: API URL points to production; write tests refused'
      )
    }
  }
}

/** Script’ler için: blokta exit 2 + mesaj. */
export function requireSafeTestDatabaseOrExit(opts?: { apiUrl?: string | null }): void {
  try {
    assertSafeTestDatabase(opts)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(msg)
    process.exit(2)
  }
}

export function requireSafeMessagingTestOrExit(opts?: {
  allowRealWithExplicitFlag?: boolean
}): void {
  try {
    assertSafeMessagingTest(opts)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(msg)
    process.exit(2)
  }
}
