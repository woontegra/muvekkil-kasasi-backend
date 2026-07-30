/**
 * Production smoke — parola env’den; çıktıda secret yok.
 * E2E_API_URL / PROD_API_URL + ADMIN_BOOTSTRAP_PASSWORD + E2E_USER/E2E_PASSWORD
 */
import 'dotenv/config'

const API = (
  process.env.PROD_API_URL ??
  process.env.E2E_API_URL ??
  'https://muvekkil-kasasi-backend-production.up.railway.app'
).replace(/\/$/, '')

function resolveFrontendOrigin(): string {
  const fromEnv = process.env.PROD_FRONTEND_ORIGIN?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  const fe = process.env.FRONTEND_URL?.trim() || process.env.PUBLIC_APP_URL?.trim()
  if (fe) {
    try {
      return new URL(fe).origin
    } catch {
      /* ignore */
    }
  }
  return 'https://muvekkil-kasasi-frontend.vercel.app'
}

const FRONTEND_ORIGIN = resolveFrontendOrigin()

const infoPass = process.env.ADMIN_BOOTSTRAP_PASSWORD
const e2eUser = process.env.E2E_USER ?? 'e2e.sahip'
const e2ePass = process.env.E2E_PASSWORD ?? 'E2eTestPass123!'

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
      Origin: FRONTEND_ORIGIN,
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
  console.info('[prod-smoke] API', API)
  console.info('[prod-smoke] frontendOriginHost', (() => {
    try {
      return new URL(FRONTEND_ORIGIN).host
    } catch {
      return '(invalid)'
    }
  })())

  const health = await jsonFetch('/health')
  record('health', health.status === 200 && (health.body as { ok?: boolean })?.ok === true)

  if (!infoPass) {
    record('info@ login', false, 'ADMIN_BOOTSTRAP_PASSWORD yok')
  } else {
    const login = await jsonFetch('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'info@woontegra.com', sifre: infoPass })
    })
    const b = login.body as {
      accessToken?: string
      adminAccessToken?: string
      adminUser?: { rol?: string; aktifMi?: boolean }
      tenant?: { slug?: string }
    } | null
    record('info@ login 200', login.status === 200)
    record('tenant token', !!b?.accessToken)
    record('admin token auto', !!b?.adminAccessToken, 'deployed code marker')
    record('admin SUPER_ADMIN', b?.adminUser?.rol === 'SUPER_ADMIN' && b?.adminUser?.aktifMi === true)
    record('tenant woontegra', b?.tenant?.slug === 'woontegra')
    record('mkd_rt cookie', login.setCookie.some((c) => c.startsWith('mkd_rt=')))
    record('mkd_admin_rt cookie', login.setCookie.some((c) => c.startsWith('mkd_admin_rt=')))

    if (b?.adminAccessToken) {
      const me = await jsonFetch('/api/v1/admin/me', {
        headers: { Authorization: `Bearer ${b.adminAccessToken}` }
      })
      record('admin/me', me.status === 200)
      const dash = await jsonFetch('/api/v1/admin/dashboard', {
        headers: { Authorization: `Bearer ${b.adminAccessToken}` }
      })
      record('admin dashboard', dash.status === 200)
    }

    if (b?.accessToken) {
      const deny = await jsonFetch('/api/v1/admin/dashboard', {
        headers: { Authorization: `Bearer ${b.accessToken}` }
      })
      record('tenant JWT admin deny', deny.status === 401 || deny.status === 403)
    }

    const cookieHeader = login.setCookie.map((c) => c.split(';')[0]).join('; ')
    if (cookieHeader) {
      const logout = await fetch(`${API}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: FRONTEND_ORIGIN,
          Cookie: cookieHeader
        }
      })
      let logoutBody = ''
      try {
        logoutBody = (await logout.text()).slice(0, 120)
      } catch {
        logoutBody = ''
      }
      record('logout', logout.status === 200, `status=${logout.status}`)
      if (logout.status !== 200 && logoutBody) {
        console.info('[prod-smoke] logout body', logoutBody.replace(/Bearer\s+\S+/gi, 'Bearer ***'))
      }
    }
  }

  const e2e = await jsonFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: e2eUser, sifre: e2ePass })
  })
  const eb = e2e.body as { accessToken?: string; adminAccessToken?: string } | null
  record('e2e login', e2e.status === 200)
  record('e2e no admin token', e2e.status === 200 && !eb?.adminAccessToken)
  if (eb?.accessToken) {
    const deny = await jsonFetch('/api/v1/admin/dashboard', {
      headers: { Authorization: `Bearer ${eb.accessToken}` }
    })
    record('e2e admin deny', deny.status === 401 || deny.status === 403)
  }

  for (const path of [
    '/api/v1/integrations/woontegra-website/tenants/provision',
    '/api/v1/integrations/woontegra-website/tenants/renew'
  ]) {
    const r = await jsonFetch(path, { method: 'POST', body: '{}' })
    // route ayakta: 401/403/400/422 — 404 değil
    record(`route ${path}`, r.status !== 404, `status=${r.status}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.info(`\n[prod-smoke] ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
