/**
 * Prim API yetki doğrulaması.
 * Çalıştır: npx tsx scripts/verify-prim-auth.ts
 */
import { UserRole } from '@prisma/client'
import { createApp } from '../src/app.js'
import { signAccessToken } from '../src/auth/jwt.js'
import { prisma } from '../src/lib/prisma.js'

type Case = { method: string; path: string; body?: unknown }

const PRIM_ONLY: Case[] = [
  { method: 'GET', path: '/api/v1/prim/kurallar' },
  { method: 'POST', path: '/api/v1/prim/kurallar', body: {} },
  { method: 'GET', path: '/api/v1/prim/personel-ozet?yil=2026&ay=6' },
  { method: 'GET', path: '/api/v1/prim/rapor?yil=2026&ay=6' },
  { method: 'POST', path: '/api/v1/prim/rapor/hesapla', body: { yil: 2026, ay: 6 } },
  { method: 'GET', path: '/api/v1/prim-personel' },
  { method: 'GET', path: '/api/v1/prim-personel/link-kullanicilar' }
]

const STAFF_ALLOWED: Case[] = [
  { method: 'GET', path: '/api/v1/prim-personel/aktif' },
  { method: 'GET', path: '/api/v1/prim-personel/bagli-ben' }
]

async function request(base: string, token: string, c: Case): Promise<number> {
  const res = await fetch(`${base}${c.path}`, {
    method: c.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: c.body != null ? JSON.stringify(c.body) : undefined
  })
  return res.status
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { role: UserRole.BURO_SAHIBI, aktifMi: true },
    select: { id: true, tenantId: true, kullaniciAdi: true, role: true }
  })
  const staff = await prisma.user.findFirst({
    where: {
      aktifMi: true,
      role: { in: [UserRole.KATIP_PERSONEL, UserRole.AVUKAT_YONETICI] }
    },
    select: { id: true, tenantId: true, kullaniciAdi: true, role: true }
  })

  if (!owner || !staff) {
    console.error('Test için aktif büro sahibi ve alt kullanıcı bulunamadı.')
    process.exit(1)
  }

  const ownerToken = signAccessToken({
    userId: owner.id,
    tenantId: owner.tenantId,
    role: owner.role,
    kullaniciAdi: owner.kullaniciAdi
  })
  const staffToken = signAccessToken({
    userId: staff.id,
    tenantId: staff.tenantId,
    role: staff.role,
    kullaniciAdi: staff.kullaniciAdi
  })

  const app = createApp()
  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  const base = `http://127.0.0.1:${port}`

  console.log(`Büro sahibi: ${owner.kullaniciAdi} (${owner.role})`)
  console.log(`Alt kullanıcı: ${staff.kullaniciAdi} (${staff.role})`)
  console.log('--- Prim modülü (403 beklenen alt kullanıcı) ---')

  let ok = true
  for (const c of PRIM_ONLY) {
    const staffStatus = await request(base, staffToken, c)
    const ownerStatus = await request(base, ownerToken, c)
    const staffOk = staffStatus === 403
    const ownerOk = ownerStatus < 500 && ownerStatus !== 403
    if (!staffOk || !ownerOk) ok = false
    console.log(
      `${c.method} ${c.path}`,
      `staff=${staffStatus}${staffOk ? ' ✓' : ' FAIL'}`,
      `owner=${ownerStatus}${ownerOk ? ' ✓' : ' FAIL'}`
    )
  }

  console.log('--- İcra tahsilat yardımcı (personel erişebilir) ---')
  for (const c of STAFF_ALLOWED) {
    const staffStatus = await request(base, staffToken, c)
    const ownerStatus = await request(base, ownerToken, c)
    const staffOk = staffStatus < 500 && staffStatus !== 403
    const ownerOk = ownerStatus < 500 && ownerStatus !== 403
    if (!staffOk || !ownerOk) ok = false
    console.log(
      `${c.method} ${c.path}`,
      `staff=${staffStatus}${staffOk ? ' ✓' : ' FAIL'}`,
      `owner=${ownerStatus}${ownerOk ? ' ✓' : ' FAIL'}`
    )
  }

  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  await prisma.$disconnect()
  console.log(ok ? '\nTÜM KONTROLLER GEÇTİ' : '\nBAZI KONTROLLER BAŞARISIZ')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
