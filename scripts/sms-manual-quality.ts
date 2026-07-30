import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const API = (process.env.E2E_API_URL ?? `http://localhost:${process.env.PORT ?? 4100}`).replace(/\/$/, '')
const PASS = process.env.E2E_PASSWORD ?? 'E2eTestPass123!'

async function api(path: string, init?: RequestInit & { token?: string }) {
  const headers = new Headers(init?.headers)
  if (init?.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (init?.token) headers.set('Authorization', `Bearer ${init.token}`)
  const res = await fetch(`${API}${path}`, { ...init, headers })
  const text = await res.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { status: res.status, body }
}

async function login(identifier: string) {
  const r = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, sifre: PASS })
  })
  if (r.status !== 200 || !r.body?.accessToken) throw new Error(`login failed: ${identifier}`)
  return { token: r.body.accessToken as string, tenantId: r.body.user.tenantId as string }
}

function ymd(days = 30) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const table = await prisma.$queryRawUnsafe<Array<{ t: string | null }>>(
    `SELECT to_regclass('public.sms_tenant_bakiye')::text AS t`
  )
  if (!table[0]?.t) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'sms_tenant_bakiye migration uygulanmamis' }))
    return
  }

  const owner = await login('e2e.sahip')
  const katip = await login('e2e.katip')
  const stamp = Date.now()

  const m = await api('/api/v1/muvekkiller', {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ tur: 'GERCEK', adSoyad: `SMS QA ${stamp}`, telefon: '05329991122' })
  })
  const muvekkilId = (m.body?.muvekkil ?? m.body)?.id as string
  const d = await api(`/api/v1/muvekkiller/${muvekkilId}/dosyalar`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ konuBasligi: `SMS QA Dosya ${stamp}`, dosyaTuru: 'DAVA' })
  })
  const dosyaId = (d.body?.dosya ?? d.body)?.id as string
  await api(`/api/v1/dosyalar/${dosyaId}/vekalet`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ toplamTutar: 1000 })
  })
  const t = await api(`/api/v1/dosyalar/${dosyaId}/vekalet/tek-taksit`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ vadeTarihi: ymd(), tutar: 1000 })
  })
  const taksitId = t.body?.taksit?.id as string

  const preview = await api(`/api/v1/tahsilat-merkezi/${taksitId}/manual-sms/preview`, { token: owner.token })
  if (preview.status !== 200) throw new Error('manuel sms preview başarısız')

  await prisma.smsTenantBakiye.upsert({ where: { tenantId: owner.tenantId }, create: { tenantId: owner.tenantId }, update: { mevcutBakiye: 1 } })
  const insuf = await api(`/api/v1/tahsilat-merkezi/${taksitId}/manual-sms/send`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ mesaj: preview.body.mesaj, idempotencyKey: `insuf-${stamp}` })
  })
  if (insuf.status !== 422) throw new Error('yetersiz bakiye testi başarısız')

  await prisma.smsTenantBakiye.update({ where: { tenantId: owner.tenantId }, data: { mevcutBakiye: 50 } })
  const idem = `same-${stamp}`
  const s1 = await api(`/api/v1/tahsilat-merkezi/${taksitId}/manual-sms/send`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ mesaj: preview.body.mesaj, idempotencyKey: idem })
  })
  const s2 = await api(`/api/v1/tahsilat-merkezi/${taksitId}/manual-sms/send`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ mesaj: preview.body.mesaj, idempotencyKey: idem })
  })
  if (s1.status !== 200 || s2.status !== 200 || s2.body?.status !== 'DUPLICATE') throw new Error('idempotency testi başarısız')

  const katipSend = await api(`/api/v1/tahsilat-merkezi/${taksitId}/manual-sms/send`, {
    method: 'POST',
    token: katip.token,
    body: JSON.stringify({ mesaj: preview.body.mesaj, idempotencyKey: `katip-${stamp}` })
  })
  if (katipSend.status !== 403) throw new Error('katip 403 testi başarısız')

  await api(`/api/v1/vekalet-taksitleri/${taksitId}/odemeler`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ tutar: 1000, odemeYontemi: 'NAKIT' })
  })
  const paidBlocked = await api(`/api/v1/tahsilat-merkezi/${taksitId}/manual-sms/send`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ mesaj: preview.body.mesaj, idempotencyKey: `paid-${stamp}` })
  })
  if (paidBlocked.status !== 422) throw new Error('tam ödenmiş taksit engeli başarısız')

  console.log(JSON.stringify({ ok: true, preview: true, insufficient: true, idempotent: true, katip403: true, paidBlocked: true }))
}

main().catch((e) => {
  console.error('[sms-manual-quality] failed', e instanceof Error ? e.message : e)
  process.exit(1)
}).finally(async () => prisma.$disconnect())
