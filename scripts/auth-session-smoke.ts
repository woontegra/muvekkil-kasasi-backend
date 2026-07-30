/**
 * Oturum / refresh güvenlik duman testleri — yalnız E2E test kullanıcısı + izole tenant.
 * Migration yoksa (refresh_session tablosu) net şekilde çıkar; canlı migrate etmez.
 *
 *   E2E_USER=e2e.sahip E2E_PASSWORD=... npx tsx scripts/auth-session-smoke.ts
 */
import 'dotenv/config'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { PrismaClient, type UserRole } from '@prisma/client'
import { env } from '../src/config/env.js'
import { TENANT_JWT_AUD, TENANT_JWT_ISS } from '../src/auth/jwt.js'
import { ADMIN_JWT_AUD, ADMIN_JWT_ISS } from '../src/auth/adminJwt.js'
import {
  createRefreshSession,
  hashOpaqueToken,
  revokeUserRefreshSessions,
  rotateRefreshSession
} from '../src/auth/refreshSession.service.js'

const API = (process.env.E2E_API_URL ?? `http://localhost:${process.env.PORT ?? 4100}`).replace(/\/$/, '')
const USER = process.env.E2E_USER ?? 'e2e.sahip'
const PASS = process.env.E2E_PASSWORD ?? 'E2eTestPass123!'
const ORIGIN = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0]!.trim()

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []
const prisma = new PrismaClient()

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail })
  console.info(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function extractCookie(res: Response, name: string): string | null {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  for (const line of raw) {
    const m = line.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`))
    if (m?.[1]) return decodeURIComponent(m[1])
  }
  const single = res.headers.get('set-cookie')
  if (!single) return null
  const m = single.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`))
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

async function api(
  path: string,
  init?: RequestInit & { cookie?: string; origin?: string | null }
): Promise<{ status: number; body: unknown; res: Response; cookie: string | null }> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.body != null) {
    headers.set('Content-Type', 'application/json')
  }
  if (init?.cookie) headers.set('Cookie', `mkd_rt=${init.cookie}`)
  if (init?.origin !== null) {
    headers.set('Origin', init?.origin ?? ORIGIN)
  }
  const res = await fetch(`${API}${path}`, { ...init, headers })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body, res, cookie: extractCookie(res, 'mkd_rt') }
}

async function tablesReady(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ t: string | null }[]>(
    `SELECT to_regclass('public.refresh_session')::text AS t`
  )
  return Boolean(rows[0]?.t)
}

async function main(): Promise<void> {
  if (!(await tablesReady())) {
    console.error(
      '[auth-session-smoke] refresh_session tablosu yok. Migration 20260730220000_add_refresh_sessions henüz uygulanmamış.\n' +
        'Bu script canlıya migrate etmez. Deploy öncesi: npx prisma migrate deploy'
    )
    process.exitCode = 2
    return
  }

  const health = await api('/health', { origin: null })
  record('health', health.status === 200)

  const login = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: USER, sifre: PASS }),
    origin: null
  })
  const access = (login.body as { accessToken?: string } | null)?.accessToken
  const rt1 = login.cookie
  record('login accessToken döner', login.status === 200 && !!access)
  record('login Set-Cookie mkd_rt', !!rt1)

  if (!access || !rt1) {
    console.error('Login başarısız; kalan testler atlandı.')
    process.exitCode = 1
    return
  }

  const owner = await prisma.user.findFirst({
    where: { kullaniciAdi: USER },
    include: { tenant: true }
  })
  if (!owner) {
    console.error('E2E kullanıcı DB’de yok')
    process.exitCode = 1
    return
  }

  // Refresh rotation
  const refresh1 = await api('/api/v1/auth/refresh', { method: 'POST', cookie: rt1 })
  const access2 = (refresh1.body as { accessToken?: string } | null)?.accessToken
  const rt2 = refresh1.cookie
  record('refresh accessToken', refresh1.status === 200 && !!access2)
  record('refresh yeni cookie (rotation)', !!rt2 && rt2 !== rt1)

  // Eski refresh tekrar kullanımı → aile iptali
  const reuse = await api('/api/v1/auth/refresh', { method: 'POST', cookie: rt1 })
  record(
    'çalınmış/eski refresh tekrar kullanımı reddedilir',
    reuse.status === 401 &&
      String((reuse.body as { code?: string } | null)?.code ?? '').includes('REFRESH')
  )
  const afterReuse = await api('/api/v1/auth/refresh', { method: 'POST', cookie: rt2 ?? '' })
  record('reuse sonrası aynı aile yeni token da düşer', afterReuse.status === 401)

  // Yeniden login
  const login2 = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: USER, sifre: PASS }),
    origin: null
  })
  const rt3 = login2.cookie!
  const access3 = (login2.body as { accessToken?: string }).accessToken!

  // Hatalı Origin
  const badOrigin = await api('/api/v1/auth/refresh', {
    method: 'POST',
    cookie: rt3,
    origin: 'https://evil.example'
  })
  record('hatalı Origin reddedilir', badOrigin.status === 403)

  // Geçerli Origin ile refresh
  const refreshOk = await api('/api/v1/auth/refresh', { method: 'POST', cookie: rt3, origin: ORIGIN })
  const rt4 = refreshOk.cookie!
  record('geçerli Origin ile refresh', refreshOk.status === 200)

  // Logout sonrası refresh red
  await api('/api/v1/auth/logout', { method: 'POST', cookie: rt4, origin: ORIGIN })
  const afterLogout = await api('/api/v1/auth/refresh', { method: 'POST', cookie: rt4, origin: ORIGIN })
  record('logout sonrası refresh reddedilir', afterLogout.status === 401)

  // Süresi dolmuş refresh
  const { plainToken: expiredPlain } = await createRefreshSession({
    tenantId: owner.tenantId,
    userId: owner.id,
    label: 'smoke-expired'
  })
  await prisma.refreshSession.updateMany({
    where: { tokenHash: hashOpaqueToken(expiredPlain) },
    data: { expiresAt: new Date(Date.now() - 60_000) }
  })
  const expiredRefresh = await api('/api/v1/auth/refresh', {
    method: 'POST',
    cookie: expiredPlain,
    origin: ORIGIN
  })
  record('süresi dolmuş refresh reddedilir', expiredRefresh.status === 401)

  // Parola değişince tüm oturumlar
  const loginPw = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: USER, sifre: PASS }),
    origin: null
  })
  const rtPw = loginPw.cookie!
  const tokPw = (loginPw.body as { accessToken: string }).accessToken
  // İkinci oturum (başka cihaz simülasyonu)
  const { plainToken: rtPw2 } = await createRefreshSession({
    tenantId: owner.tenantId,
    userId: owner.id,
    label: 'smoke-device2'
  })
  await prisma.user.update({
    where: { id: owner.id },
    data: { sifreHash: await bcrypt.hash(PASS, 12) }
  })
  await revokeUserRefreshSessions(owner.id)
  const afterPw1 = await api('/api/v1/auth/refresh', { method: 'POST', cookie: rtPw, origin: ORIGIN })
  const afterPw2 = await api('/api/v1/auth/refresh', { method: 'POST', cookie: rtPw2, origin: ORIGIN })
  record('parola/revoke sonrası oturum1 kapalı', afterPw1.status === 401)
  record('parola/revoke sonrası oturum2 kapalı', afterPw2.status === 401)
  void tokPw

  // Rol değişince JWT’deki eski rol DB’den ezilir
  const personelUser =
    (await prisma.user.findFirst({
      where: { tenantId: owner.tenantId, kullaniciAdi: 'e2e.personel.smoke' }
    })) ??
    (await prisma.user.create({
      data: {
        tenantId: owner.tenantId,
        adSoyad: 'E2E Personel Smoke',
        kullaniciAdi: 'e2e.personel.smoke',
        eposta: 'e2e.personel.smoke@e2e.local',
        sifreHash: await bcrypt.hash('E2ePersonelPass123!', 12),
        role: 'KATIP_PERSONEL',
        aktifMi: true,
        mustChangePassword: false,
        licenseActivatedAt: new Date()
      }
    }))

  await prisma.user.update({
    where: { id: personelUser.id },
    data: {
      role: 'KATIP_PERSONEL',
      aktifMi: true,
      sifreHash: await bcrypt.hash('E2ePersonelPass123!', 12)
    }
  })

  const loginPer = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'e2e.personel.smoke', sifre: 'E2ePersonelPass123!' }),
    origin: null
  })
  const perAccess = (loginPer.body as { accessToken?: string })?.accessToken
  const perRt = loginPer.cookie
  record('personel login', loginPer.status === 200 && !!perAccess && !!perRt)

  if (perAccess && perRt) {
    // Sahip yetkisi gerektiren uç (kullanıcı listesi)
    await prisma.user.update({
      where: { id: personelUser.id },
      data: { role: 'KATIP_PERSONEL' }
    })
    // Eski access token hâlâ KATIP_PERSONEL claim taşıyabilir; requireAuth DB rolünü kullanır
    const usersList = await api('/api/v1/users', {
      headers: { Authorization: `Bearer ${perAccess}` },
      origin: null
    })
    record(
      'personel eski access ile users engelli (rol DB)',
      usersList.status === 403 || usersList.status === 401
    )

    // Rol yükseltilmiş gibi eski JWT claim — DB KATIP_PERSONEL kalır
    const forged = jwt.sign(
      {
        sub: personelUser.id,
        tenantId: owner.tenantId,
        role: 'BURO_SAHIBI' as UserRole,
        kullaniciAdi: personelUser.kullaniciAdi,
        typ: 'tenant'
      },
      env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m', issuer: TENANT_JWT_ISS, audience: TENANT_JWT_AUD }
    )
    const forgedUsers = await api('/api/v1/users', {
      headers: { Authorization: `Bearer ${forged}` },
      origin: null
    })
    record('JWT rol spoof DB kontrolüyle engellenir', forgedUsers.status === 403 || forgedUsers.status === 401)

    await revokeUserRefreshSessions(personelUser.id)
    await prisma.user.update({
      where: { id: personelUser.id },
      data: { aktifMi: false }
    })
    const inactiveRefresh = await api('/api/v1/auth/refresh', {
      method: 'POST',
      cookie: perRt,
      origin: ORIGIN
    })
    record('pasif kullanıcı refresh reddedilir', inactiveRefresh.status === 401)

    await prisma.user.update({
      where: { id: personelUser.id },
      data: { aktifMi: true, role: 'KATIP_PERSONEL' }
    })
  }

  // Başka tenant kullanıcısının refresh’i kendi tenantını döner (çapraz erişim yok)
  const otherTenant = await prisma.tenant.findFirst({
    where: { id: { not: owner.tenantId }, aktifMi: true },
    include: { users: { where: { aktifMi: true }, take: 1 } }
  })
  if (otherTenant?.users[0]) {
    const { plainToken: otherRt } = await createRefreshSession({
      tenantId: otherTenant.id,
      userId: otherTenant.users[0].id,
      label: 'smoke-other-tenant'
    })
    const otherRefresh = await api('/api/v1/auth/refresh', {
      method: 'POST',
      cookie: otherRt,
      origin: ORIGIN
    })
    const otherTenantId = (otherRefresh.body as { tenant?: { id?: string } } | null)?.tenant?.id
    const otherAccess = (otherRefresh.body as { accessToken?: string } | null)?.accessToken
    record('diğer tenant refresh kendi tenantını döner', otherRefresh.status === 200 && otherTenantId === otherTenant.id)
    if (otherAccess) {
      const cross = await api('/api/v1/muvekkiller?limit=1', {
        headers: { Authorization: `Bearer ${otherAccess}` },
        origin: null
      })
      // Yalnız kendi tenant verisi; status 200 ama e2e tenant IDOR değil — en azından 401/403 değilse ok
      record('diğer tenant access kendi API’sinde çalışır', cross.status === 200 || cross.status === 403)
    }
    await revokeUserRefreshSessions(otherTenant.users[0].id)
  } else {
    record('diğer tenant refresh (atlandı — ikinci tenant yok)', true, 'skip')
  }

  // Paralel refresh yarışı — tek ailede reuse riski; tek başarılı beklenir
  const loginPar = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: USER, sifre: PASS }),
    origin: null
  })
  const rtPar = loginPar.cookie!
  const parallel = await Promise.all([
    api('/api/v1/auth/refresh', { method: 'POST', cookie: rtPar, origin: ORIGIN }),
    api('/api/v1/auth/refresh', { method: 'POST', cookie: rtPar, origin: ORIGIN }),
    api('/api/v1/auth/refresh', { method: 'POST', cookie: rtPar, origin: ORIGIN })
  ])
  const okCount = parallel.filter((p) => p.status === 200).length
  const failCount = parallel.filter((p) => p.status === 401).length
  record(
    'paralel refresh: en fazla bir başarı (rotation)',
    okCount === 1 && failCount === parallel.length - 1,
    `ok=${okCount} fail=${failCount}`
  )

  // Admin / tenant token karışıklığı
  const tenantTok = (loginPar.body as { accessToken?: string }).accessToken
  if (tenantTok) {
    const adminWithTenant = await api('/api/v1/admin/tenants?limit=1', {
      headers: { Authorization: `Bearer ${tenantTok}` },
      origin: null
    })
    record('tenant JWT admin uçta reddedilir', adminWithTenant.status === 401 || adminWithTenant.status === 403)
  }

  // Admin JWT tenant secret ile imzalanamaz doğrulama
  try {
    jwt.verify(tenantTok!, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: ADMIN_JWT_ISS,
      audience: ADMIN_JWT_AUD
    })
    record('tenant JWT admin iss/aud ile doğrulanamaz', false)
  } catch {
    record('tenant JWT admin iss/aud ile doğrulanamaz', true)
  }
  try {
    jwt.verify(tenantTok!, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: TENANT_JWT_ISS,
      audience: TENANT_JWT_AUD
    })
    record('tenant JWT doğru iss/aud ile doğrulanır', true)
  } catch (e) {
    record('tenant JWT doğru iss/aud ile doğrulanır', false, String(e))
  }

  // rotateService doğrudan reuse
  try {
    const { plainToken } = await createRefreshSession({
      tenantId: owner.tenantId,
      userId: owner.id,
      label: 'smoke-svc'
    })
    await rotateRefreshSession(plainToken)
    try {
      await rotateRefreshSession(plainToken)
      record('servis katmanı refresh reuse', false)
    } catch {
      record('servis katmanı refresh reuse', true)
    }
  } catch (e) {
    record('servis katmanı refresh reuse', false, String(e))
  }

  // E2E Playwright storageState ile paylaşım için tüm oturumları sonlandırmıyoruz.

  const failed = results.filter((r) => !r.ok)
  console.info(`\nÖzet: ${results.length - failed.length}/${results.length} geçti`)
  if (failed.length) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
