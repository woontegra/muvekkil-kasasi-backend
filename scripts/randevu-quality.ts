/**
 * Randevu modülü hedefli API testleri — E2E tenant A/B gerekir.
 *
 *   npx tsx scripts/e2e-provision-phase2.ts
 *   npx tsx scripts/randevu-quality.ts
 */
import 'dotenv/config'

const API = (process.env.E2E_API_URL ?? `http://localhost:${process.env.PORT ?? 4100}`).replace(/\/$/, '')
const PASS = process.env.E2E_PASSWORD ?? process.env.E2E_OWNER_PASSWORD ?? 'E2eTestPass123!'
const ORIGIN = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0]!.trim()

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail })
  console.info(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function api(
  path: string,
  init?: RequestInit & { token?: string }
): Promise<{ status: number; body: any; text: string }> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.body != null) headers.set('Content-Type', 'application/json')
  if (init?.token) headers.set('Authorization', `Bearer ${init.token}`)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  const res = await fetch(`${API}${path}`, { ...init, headers })
  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  return { status: res.status, body, text }
}

async function login(user: string): Promise<{ token: string; tenantId: string; userId: string }> {
  const r = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: user, sifre: PASS })
  })
  if (r.status !== 200 || !r.body?.accessToken) {
    throw new Error(`Login failed for ${user}: ${r.status}`)
  }
  return {
    token: r.body.accessToken as string,
    tenantId: r.body.user.tenantId as string,
    userId: r.body.user.id as string
  }
}

function isoRange(daysFrom = 0, daysTo = 7): { baslangic: string; bitis: string } {
  const s = new Date()
  s.setDate(s.getDate() + daysFrom)
  s.setHours(0, 0, 0, 0)
  const e = new Date()
  e.setDate(e.getDate() + daysTo)
  e.setHours(23, 59, 59, 999)
  return { baslangic: s.toISOString(), bitis: e.toISOString() }
}

function todayRange(): { baslangic: string; bitis: string } {
  const s = new Date()
  s.setHours(0, 0, 0, 0)
  const e = new Date()
  e.setHours(23, 59, 59, 999)
  return { baslangic: s.toISOString(), bitis: e.toISOString() }
}

async function main(): Promise<void> {
  const a = await login('e2e.sahip')
  const b = await login('e2e.b.sahip')

  const stamp = Date.now()
  const mA = await api('/api/v1/muvekkiller', {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tur: 'GERCEK', adSoyad: `Randevu QA ${stamp}`, telefon: '05321112233' })
  })
  record('Tenant A müvekkil oluştur', mA.status === 201, `status=${mA.status}`)
  const muvekkilAId = mA.body?.muvekkil?.id as string | undefined

  const mB = await api('/api/v1/muvekkiller', {
    method: 'POST',
    token: b.token,
    body: JSON.stringify({ tur: 'GERCEK', adSoyad: `Randevu QB ${stamp}`, telefon: '05324445566' })
  })
  const muvekkilBId = mB.body?.muvekkil?.id as string | undefined

  const start = new Date()
  start.setDate(start.getDate() + 1)
  start.setHours(10, 0, 0, 0)
  const end = new Date(start)
  end.setHours(11, 0, 0, 0)

  const create = await api('/api/v1/randevular', {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({
      baslik: `Randevu ${stamp}`,
      baslangicAt: start.toISOString(),
      bitisAt: end.toISOString(),
      muvekkilId: muvekkilAId ?? null
    })
  })
  record('Randevu oluşturma', create.status === 201, `status=${create.status}`)
  const randevuId = create.body?.randevu?.id as string | undefined

  const crossGet = randevuId
    ? await api(`/api/v1/randevular/${randevuId}`, { token: b.token })
    : { status: 0, body: null, text: '' }
  record('Tenant B başka tenant randevusunu göremez', crossGet.status === 404, `status=${crossGet.status}`)

  const wrongMu = await api('/api/v1/randevular', {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({
      baslik: 'Yanlış müvekkil',
      baslangicAt: start.toISOString(),
      bitisAt: end.toISOString(),
      muvekkilId: muvekkilBId
    })
  })
  record('Yanlış tenant muvekkilId reddedilir', wrongMu.status === 400, `status=${wrongMu.status}`)

  const badRange = await api('/api/v1/randevular', {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({
      baslik: 'Geçersiz saat',
      baslangicAt: end.toISOString(),
      bitisAt: start.toISOString()
    })
  })
  record('startAt >= endAt reddedilir', badRange.status === 400, `status=${badRange.status}`)

  if (randevuId) {
    const patch = await api(`/api/v1/randevular/${randevuId}`, {
      method: 'PATCH',
      token: a.token,
      body: JSON.stringify({
        baslik: `Randevu güncellendi ${stamp}`,
        baslangicAt: start.toISOString(),
        bitisAt: end.toISOString(),
        muvekkilId: muvekkilAId ?? null
      })
    })
    record('Randevu düzenleme', patch.status === 200, `status=${patch.status}`)
  }

  const range = isoRange(-1, 14)
  const list = await api(
    `/api/v1/randevular?baslangic=${encodeURIComponent(range.baslangic)}&bitis=${encodeURIComponent(range.bitis)}`,
    { token: a.token }
  )
  record('Tarih aralığı listeleme', list.status === 200 && Array.isArray(list.body?.items), `status=${list.status}`)

  if (muvekkilAId) {
    const filt = await api(
      `/api/v1/randevular?baslangic=${encodeURIComponent(range.baslangic)}&bitis=${encodeURIComponent(range.bitis)}&muvekkilId=${muvekkilAId}`,
      { token: a.token }
    )
    const allMatch = (filt.body?.items ?? []).every((r: { muvekkilId: string | null }) => r.muvekkilId === muvekkilAId)
    record('Müvekkil filtreleme', filt.status === 200 && allMatch, `count=${filt.body?.items?.length ?? 0}`)
  }

  const today = todayRange()
  const todayList = await api(
    `/api/v1/randevular?baslangic=${encodeURIComponent(today.baslangic)}&bitis=${encodeURIComponent(today.bitis)}`,
    { token: a.token }
  )
  record('Dashboard bugünkü randevular API', todayList.status === 200, `status=${todayList.status}`)

  if (randevuId) {
    const del = await api(`/api/v1/randevular/${randevuId}`, { method: 'DELETE', token: a.token })
    record('Randevu silme', del.status === 204, `status=${del.status}`)
    const after = await api(`/api/v1/randevular/${randevuId}`, { token: a.token })
    record('Silinen randevu GET 404', after.status === 404, `status=${after.status}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.info(`\nÖzet: ${results.length - failed.length}/${results.length} geçti`)
  if (failed.length > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
