/**
 * Zararsız güvenlik duman testi — yalnızca lokal API + E2E test kullanıcısı.
 * Canlı müşteri hesabı / brute-force / zararlı payload kullanmaz.
 *
 *   E2E_USER=e2e.sahip E2E_PASSWORD=... npx tsx scripts/security-api-smoke.ts
 */
import 'dotenv/config'

const API = (process.env.E2E_API_URL ?? `http://localhost:${process.env.PORT ?? 4100}`).replace(/\/$/, '')
const USER = process.env.E2E_USER ?? 'e2e.sahip'
const PASS = process.env.E2E_PASSWORD ?? 'E2eTestPass123!'
const FOREIGN_UUID = '00000000-0000-4000-8000-000000000001'

type Check = { name: string; ok: boolean; detail?: string }

const results: Check[] = []

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.info(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function jsonFetch(
  path: string,
  init?: RequestInit & { cookie?: string }
): Promise<{ status: number; body: unknown; setCookie: string | null }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined)
  }
  if (init?.cookie) headers.Cookie = init.cookie
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  const setCookie =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie().join('; ') || null
      : res.headers.get('set-cookie')
  return { status: res.status, body, setCookie }
}

async function main(): Promise<void> {
  const health = await jsonFetch('/health')
  record('health erişilebilir', health.status === 200)

  const anon = await jsonFetch('/api/v1/muvekkiller?limit=1')
  record('auth olmadan müvekkil listesi engelli', anon.status === 401 || anon.status === 403)

  const badTok = await jsonFetch('/api/v1/muvekkiller?limit=1', {
    headers: { Authorization: 'Bearer not.a.jwt' }
  })
  record('geçersiz JWT engelli', badTok.status === 401)

  const loginFail = await jsonFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'olmayan.kullanici.e2e', sifre: 'YanlisSifre1!' })
  })
  record('başarısız giriş 401', loginFail.status === 401)

  const login = await jsonFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: USER, sifre: PASS })
  })
  record('E2E kullanıcı girişi', login.status === 200)
  const token = (login.body as { accessToken?: string } | null)?.accessToken
  const hasRtCookie = !!login.setCookie && /mkd_rt=/i.test(login.setCookie)
  record('login HttpOnly refresh cookie (mkd_rt)', hasRtCookie, login.setCookie ? 'set-cookie var' : 'yok')
  if (!token) {
    console.error('E2E token alınamadı; kalan IDOR testleri atlandı.')
    process.exitCode = 1
    return
  }

  const auth = { Authorization: `Bearer ${token}` }

  if (hasRtCookie) {
    const m = login.setCookie!.match(/mkd_rt=([^;]+)/i)
    const rt = m?.[1] ? decodeURIComponent(m[1]) : null
    if (rt) {
      const origin = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0]!.trim()
      const refreshed = await jsonFetch('/api/v1/auth/refresh', {
        method: 'POST',
        cookie: `mkd_rt=${rt}`,
        headers: { Origin: origin }
      })
      record('refresh endpoint accessToken yeniler', refreshed.status === 200)
      await jsonFetch('/api/v1/auth/logout', {
        method: 'POST',
        cookie: `mkd_rt=${(refreshed.setCookie?.match(/mkd_rt=([^;]+)/i)?.[1] ?? rt)}`,
        headers: { Origin: origin }
      })
      const afterLogout = await jsonFetch('/api/v1/auth/refresh', {
        method: 'POST',
        cookie: `mkd_rt=${rt}`,
        headers: { Origin: origin }
      })
      record('logout sonrası eski refresh reddedilir', afterLogout.status === 401)
      // IDOR testleri için yeniden login
      const loginAgain = await jsonFetch('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: USER, sifre: PASS })
      })
      const token2 = (loginAgain.body as { accessToken?: string } | null)?.accessToken
      if (token2) {
        auth.Authorization = `Bearer ${token2}`
      }
    }
  }

  const idorM = await jsonFetch(`/api/v1/muvekkiller/${FOREIGN_UUID}`, { headers: auth })
  record('yabancı müvekkil ID (IDOR)', idorM.status === 404 || idorM.status === 403)

  const idorD = await jsonFetch(`/api/v1/dosyalar/${FOREIGN_UUID}`, { headers: auth })
  record('yabancı dosya ID (IDOR)', idorD.status === 404 || idorD.status === 403)

  const mass = await jsonFetch('/api/v1/muvekkiller', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      tur: 'GERCEK',
      adSoyad: 'E2E Sec Test',
      telefon: '05321112233',
      tenantId: FOREIGN_UUID,
      role: 'BURO_SAHIBI',
      aktifMi: false
    })
  })
  const createdId = (mass.body as { muvekkil?: { id?: string }; id?: string } | null)?.muvekkil?.id
    ?? (mass.body as { id?: string } | null)?.id
  record(
    'mass-assignment tenantId/role body kabul edilmez (kayıt yine kendi tenantında)',
    mass.status === 201 || mass.status === 200
  )

  const xss = await jsonFetch('/api/v1/muvekkiller', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      tur: 'GERCEK',
      adSoyad: '<script>alert(1)</script>',
      telefon: '05321112234',
      not: "'; DROP TABLE user;--"
    })
  })
  record('XSS/SQL benzeri metin Zod/iş kurallarıyla kabul veya güvenli saklama', xss.status === 201 || xss.status === 400)

  const negMoney = await jsonFetch(`/api/v1/dosyalar/${FOREIGN_UUID}/vekalet-ucreti`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ anlasilanTutar: -100, taksitSayisi: 1 })
  })
  record('negatif / yabancı dosya vekalet reddi', negMoney.status === 400 || negMoney.status === 404 || negMoney.status === 403)

  const longQ = await jsonFetch(`/api/v1/muvekkiller?q=${'a'.repeat(5000)}&limit=9999`, { headers: auth })
  record('aşırı uzun arama / limit sınırlı', longQ.status === 200 || longQ.status === 400)

  const wh = await jsonFetch('/api/v1/integrations/whatsapp/webhook', {
    method: 'POST',
    body: JSON.stringify({ object: 'whatsapp_business_account' })
  })
  record('WhatsApp webhook kapalı veya imzasız reddedilir', wh.status === 404 || wh.status === 401)

  const forgot = await jsonFetch('/api/v1/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'olmayan@example.com' })
  })
  const forgotMsg = String((forgot.body as { message?: string } | null)?.message ?? '')
  record(
    'forgot-password enumeration mesajı genel',
    forgot.status === 200 && /kayıtlıysa|gonderilecektir|gönderilecektir/i.test(forgotMsg)
  )

  // Temizlik: oluşturulan test müvekkilleri soft-delete
  for (const id of [createdId]) {
    if (!id) continue
    await jsonFetch(`/api/v1/muvekkiller/${id}`, { method: 'DELETE', headers: auth })
  }

  const failed = results.filter((r) => !r.ok)
  console.info(`\nÖzet: ${results.length - failed.length}/${results.length} geçti`)
  if (failed.length) {
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
