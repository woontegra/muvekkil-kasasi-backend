/**
 * Tek giriş doğrulama — parola env’den; çıktıda token/parola yok.
 * ADMIN_BOOTSTRAP_PASSWORD + isteğe bağlı API_BASE
 */
import 'dotenv/config'

const API = (process.env.E2E_API_URL ?? `http://localhost:${process.env.PORT ?? 4100}`).replace(/\/$/, '')
const EMAIL = 'info@woontegra.com'
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.info(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function jsonFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined)
    }
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body, setCookie }
}

async function main() {
  if (!password) {
    console.error('ADMIN_BOOTSTRAP_PASSWORD gerekli')
    process.exit(1)
  }

  const health = await jsonFetch('/health')
  record('API health', health.status === 200)

  const login = await jsonFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: EMAIL, sifre: password })
  })
  const loginBody = login.body as {
    accessToken?: string
    adminAccessToken?: string
    adminUser?: { rol?: string; eposta?: string | null; aktifMi?: boolean }
    user?: { eposta?: string | null; role?: string }
    tenant?: { buroAdi?: string; slug?: string }
  } | null

  record('info@ normal login 200', login.status === 200)
  record('tenant accessToken var', !!loginBody?.accessToken)
  record('adminAccessToken otomatik', !!loginBody?.adminAccessToken)
  record('adminUser SUPER_ADMIN', loginBody?.adminUser?.rol === 'SUPER_ADMIN')
  record('adminUser aktif', loginBody?.adminUser?.aktifMi === true)
  record('tenant Woontegra', loginBody?.tenant?.slug === 'woontegra')
  record(
    'tenant cookie set',
    login.setCookie.some((c) => c.startsWith('mkd_rt='))
  )
  record(
    'admin cookie set',
    login.setCookie.some((c) => c.startsWith('mkd_admin_rt='))
  )

  const tenantToken = loginBody?.accessToken
  const adminToken = loginBody?.adminAccessToken

  if (adminToken) {
    const me = await jsonFetch('/api/v1/admin/me', {
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    record('admin/me 200', me.status === 200)
    const dash = await jsonFetch('/api/v1/admin/dashboard', {
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    record('admin dashboard 200', dash.status === 200)
  }

  if (tenantToken) {
    const deny = await jsonFetch('/api/v1/admin/dashboard', {
      headers: { Authorization: `Bearer ${tenantToken}` }
    })
    record('tenant JWT admin engelli', deny.status === 401 || deny.status === 403)
  }

  // Eski admin e-posta ile giriş artık SuperAdmin email değil — tenant login da info@
  const oldAdminLogin = await jsonFetch('/api/v1/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'admin@woontegra.com', sifre: password })
  })
  record(
    'eski admin@ ile admin login başarısız',
    oldAdminLogin.status === 401 || oldAdminLogin.status === 403
  )

  const e2eUser = process.env.E2E_USER ?? 'e2e.sahip'
  const e2ePass = process.env.E2E_PASSWORD ?? 'E2eTestPass123!'
  const normalLogin = await jsonFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: e2eUser, sifre: e2ePass })
  })
  const normalBody = normalLogin.body as { accessToken?: string; adminAccessToken?: string } | null
  record('normal E2E login adminAccessToken yok', normalLogin.status === 200 && !normalBody?.adminAccessToken)
  if (normalBody?.accessToken) {
    const deny2 = await jsonFetch('/api/v1/admin/dashboard', {
      headers: { Authorization: `Bearer ${normalBody.accessToken}` }
    })
    record('normal kullanıcı admin API engelli', deny2.status === 401 || deny2.status === 403)
  }

  // Logout her iki cookie’yi temizler
  if (login.setCookie.length) {
    const cookieHeader = login.setCookie.map((c) => c.split(';')[0]).join('; ')
    const logout = await fetch(`${API}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        Origin: 'http://localhost:5173'
      }
    })
    record('logout 200', logout.status === 200)
  }

  const failed = results.filter((r) => !r.ok)
  console.info(`\n[single-login-verify] ${results.length - failed.length}/${results.length} geçti`)
  if (failed.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
