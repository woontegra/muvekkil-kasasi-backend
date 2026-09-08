/**
 * Vekalet taksit update — post-update 500 regresyon testi (E2E tenant).
 * Production verisine dokunmaz.
 *
 *   npx tsx scripts/vekalet-taksit-update-quality.ts
 */
import 'dotenv/config'

const API = (process.env.E2E_API_URL ?? `http://localhost:${process.env.PORT ?? 4100}`).replace(
  /\/$/,
  ''
)
const PASS = process.env.E2E_PASSWORD ?? process.env.E2E_OWNER_PASSWORD ?? 'E2eTestPass123!'
const USER = process.env.E2E_USER ?? 'e2e.sahip'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail })
  console.info(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function api(
  path: string,
  init?: RequestInit & { token?: string }
): Promise<{ status: number; body: any }> {
  const headers = new Headers(init?.headers)
  if (init?.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (init?.token) headers.set('Authorization', `Bearer ${init.token}`)
  const res = await fetch(`${API}${path}`, { ...init, headers })
  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  return { status: res.status, body }
}

async function main() {
  const health = await api('/health')
  record('health', health.status === 200)

  const login = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: USER, sifre: PASS })
  })
  const token = login.body?.accessToken as string | undefined
  record('login', Boolean(token), `st=${login.status}`)
  if (!token) {
    printSummary()
    process.exit(1)
  }

  const stamp = Date.now()
  const m = await api('/api/v1/muvekkiller', {
    method: 'POST',
    token,
    body: JSON.stringify({
      tur: 'GERCEK',
      adSoyad: `TaksitUpd ${stamp}`,
      telefon: '5550001122'
    })
  })
  const muvekkilId = (m.body?.muvekkil ?? m.body)?.id as string | undefined
  record('muvekkil', Boolean(muvekkilId), `st=${m.status}`)
  if (!muvekkilId) {
    printSummary()
    process.exit(1)
  }

  const d = await api(`/api/v1/muvekkiller/${muvekkilId}/dosyalar`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      konuBasligi: `Dosya TaksitUpd ${stamp}`,
      dosyaTuru: 'DAVA',
      aciklama: 'taksit update quality'
    })
  })
  const dosyaId = (d.body?.dosya ?? d.body)?.id as string | undefined
  record('dosya', Boolean(dosyaId), `st=${d.status}`)
  if (!dosyaId) {
    printSummary()
    process.exit(1)
  }

  const vek = await api(`/api/v1/dosyalar/${dosyaId}/vekalet`, {
    method: 'POST',
    token,
    body: JSON.stringify({ toplamTutar: 1000 })
  })
  record('vekalet', vek.status === 200 || vek.status === 201, `st=${vek.status}`)

  const tek = await api(`/api/v1/dosyalar/${dosyaId}/vekalet/tek-taksit`, {
    method: 'POST',
    token,
    body: JSON.stringify({ vadeTarihi: '2026-10-01T00:00:00.000Z', tutar: 1000 })
  })
  const taksit = tek.body?.taksit
  const taksitId = taksit?.id as string | undefined
  const tutar0 = String(taksit?.tutar ?? '')
  const odenen0 = String(taksit?.odenenToplam ?? '0.00')
  record('tek taksit', Boolean(taksitId), `st=${tek.status} tutar=${tutar0}`)
  if (!taksitId) {
    printSummary()
    process.exit(1)
  }

  // 1–4) Yalnız vade tarihi
  const upd = await api(`/api/v1/vekalet-taksitleri/${taksitId}`, {
    method: 'PUT',
    token,
    body: JSON.stringify({ vadeTarihi: '2026-09-08T00:00:00.000Z' })
  })
  record(
    'update yalnız vade → 200 (no 500)',
    upd.status === 200 && upd.body?.ok === true,
    `st=${upd.status} msg=${upd.body?.message}`
  )
  const vade1 = String(upd.body?.taksit?.vadeTarihi ?? '')
  const tutar1 = String(upd.body?.taksit?.tutar ?? '')
  const odenen1 = String(upd.body?.taksit?.odenenToplam ?? '')
  const durum1 = String(upd.body?.taksit?.odemeDurumu ?? '')
  record('vade 2026-09-08', vade1.startsWith('2026-09-08'), `vade=${vade1}`)
  record('tutar aynı', Number(tutar1) === 1000, `tutar=${tutar1}`)
  record('ödenen etkilenmedi', odenen1 === odenen0 || Number(odenen1) === 0, `odenen=${odenen1}`)
  record('durum ODENMEDI', durum1 === 'ODENMEDI', `durum=${durum1}`)

  // 5) Geçersiz tarih → 400
  const bad = await api(`/api/v1/vekalet-taksitleri/${taksitId}`, {
    method: 'PUT',
    token,
    body: JSON.stringify({ vadeTarihi: 'not-a-date' })
  })
  record('geçersiz tarih → 400', bad.status === 400, `st=${bad.status}`)

  // 6) Yok kayıt → 404
  const miss = await api('/api/v1/vekalet-taksitleri/00000000-0000-4000-8000-000000000099', {
    method: 'PUT',
    token,
    body: JSON.stringify({ vadeTarihi: '2026-09-09T00:00:00.000Z' })
  })
  record('yok kayıt → 404', miss.status === 404, `st=${miss.status}`)

  // TR biçimli tarih — gün kayması yok
  const tr = await api(`/api/v1/vekalet-taksitleri/${taksitId}`, {
    method: 'PUT',
    token,
    body: JSON.stringify({ vadeTarihi: '10.09.2026' })
  })
  record('DD.MM.YYYY → 200', tr.status === 200, `st=${tr.status}`)
  record(
    'DD.MM.YYYY gün kayması yok',
    String(tr.body?.taksit?.vadeTarihi ?? '').startsWith('2026-09-10'),
    `vade=${tr.body?.taksit?.vadeTarihi}`
  )

  // Tekrar kaydet — 200, mükerrer yan etki yok
  const again = await api(`/api/v1/vekalet-taksitleri/${taksitId}`, {
    method: 'PUT',
    token,
    body: JSON.stringify({ vadeTarihi: '2026-09-10T00:00:00.000Z' })
  })
  record('tekrar kaydet → 200', again.status === 200, `st=${again.status}`)

  // 7) İş kuralı 409 — tam ödenmişte tutar değişimi
  const pay = await api(`/api/v1/vekalet-taksitleri/${taksitId}/odemeler`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      tutar: 1000,
      odemeYontemi: 'NAKIT',
      odemeTarihi: '2026-09-08T00:00:00.000Z'
    })
  })
  record('tam ödeme', pay.status === 200 || pay.status === 201, `st=${pay.status}`)
  const conflict = await api(`/api/v1/vekalet-taksitleri/${taksitId}`, {
    method: 'PUT',
    token,
    body: JSON.stringify({ tutar: 1500 })
  })
  record(
    'ödenmiş tutar değişimi → 409',
    conflict.status === 409,
    `st=${conflict.status} msg=${conflict.body?.message}`
  )

  printSummary()
  if (results.some((r) => !r.ok)) process.exit(1)
}

function printSummary() {
  const fail = results.filter((r) => !r.ok).length
  console.info(`\n${results.length - fail}/${results.length} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
