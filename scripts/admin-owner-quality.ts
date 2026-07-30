/**
 * Platform sahibi SuperAdmin kalite kontrolleri.
 *
 * DB yazan senaryolar yalnızca:
 *   ADMIN_OWNER_QUALITY_ALLOW_DB=YES
 *   (+ Railway ise ADMIN_BOOTSTRAP_CONFIRM_PRODUCTION=YES)
 *
 * Parola env'den alınır; çıktıda gösterilmez.
 */
import 'dotenv/config'
import bcrypt from 'bcrypt'
import { PrismaClient } from '@prisma/client'
import { signAdminAccessToken } from '../src/auth/adminJwt.js'
import { bootstrapOwnerAdmin, normalizeEmail, BCRYPT_COST } from '../src/admin/bootstrapOwnerAdmin.js'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail })
  console.info(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function maskDb(raw: string | undefined): { host: string; railway: boolean } | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return { host: u.hostname, railway: /railway|rlwy|proxy\.rlwy/i.test(u.hostname) }
  } catch {
    return null
  }
}

async function jsonFetch(
  base: string,
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined)
    }
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

async function main(): Promise<void> {
  record('normalizeEmail trim+lower', normalizeEmail('  Info@Woontegra.COM ') === 'info@woontegra.com')

  const hash = await bcrypt.hash('TempQualityPass1!', BCRYPT_COST)
  record('bcrypt cost=12 hash üretir', typeof hash === 'string' && hash.startsWith('$2'))
  record('düz parola hash içinde yok', !hash.includes('TempQualityPass1!'))

  const API = (process.env.E2E_API_URL ?? `http://localhost:${process.env.PORT ?? 4100}`).replace(/\/$/, '')
  const tenantUser = process.env.E2E_USER ?? 'e2e.sahip'
  const tenantPass = process.env.E2E_PASSWORD ?? 'E2eTestPass123!'

  try {
    const health = await jsonFetch(API, '/health')
    record('API health', health.status === 200)

    const tenantLogin = await jsonFetch(API, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: tenantUser, sifre: tenantPass })
    })
    const tenantToken = (tenantLogin.body as { accessToken?: string } | null)?.accessToken
    if (tenantToken) {
      const deny = await jsonFetch(API, '/api/v1/admin/dashboard', {
        headers: { Authorization: `Bearer ${tenantToken}` }
      })
      record('tenant JWT admin dashboard engelli', deny.status === 401 || deny.status === 403)
      const denyMe = await jsonFetch(API, '/api/v1/admin/me', {
        headers: { Authorization: `Bearer ${tenantToken}` }
      })
      record('tenant JWT admin/me engelli', denyMe.status === 401 || denyMe.status === 403)
    } else {
      record('tenant JWT admin engeli', false, 'E2E tenant login alınamadı — atlandı')
    }
  } catch (e) {
    record('API erişimi', false, e instanceof Error ? e.message : 'bağlantı yok')
  }

  const allowDb = process.env.ADMIN_OWNER_QUALITY_ALLOW_DB === 'YES'
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim()
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD
  const dbMeta = maskDb(process.env.DATABASE_URL)

  if (!allowDb) {
    console.info('[admin-owner-quality] DB yazma testleri atlandı (ADMIN_OWNER_QUALITY_ALLOW_DB≠YES).')
  } else if (!email || !password) {
    record('bootstrap env', false, 'ADMIN_BOOTSTRAP_EMAIL/PASSWORD gerekli')
  } else if (dbMeta?.railway && process.env.ADMIN_BOOTSTRAP_CONFIRM_PRODUCTION !== 'YES') {
    record('railway onay', false, 'ADMIN_BOOTSTRAP_CONFIRM_PRODUCTION=YES gerekli')
  } else {
    const prisma = new PrismaClient()
    try {
      if (dbMeta) console.info(`[admin-owner-quality] DB host=${dbMeta.host}`)

      const first = await bootstrapOwnerAdmin(prisma, {
        email,
        password,
        adSoyad: process.env.ADMIN_BOOTSTRAP_AD_SOYAD?.trim() || 'Woontegra Süper Admin'
      })
      record('bootstrap ilk çalıştırma', first.created || first.updated)
      record('tek aktif admin', first.aktifAdminCount === 1)

      const second = await bootstrapOwnerAdmin(prisma, {
        email,
        password,
        adSoyad: process.env.ADMIN_BOOTSTRAP_AD_SOYAD?.trim() || 'Woontegra Süper Admin'
      })
      record('bootstrap ikinci çalıştırma mükerrer yok', second.created === false && second.updated === true)
      record('ikinci sonra tek aktif', second.aktifAdminCount === 1)

      const owner = await prisma.superAdmin.findFirst({
        where: { eposta: { equals: normalizeEmail(email), mode: 'insensitive' } }
      })
      record('hedef SUPER_ADMIN+aktif', !!owner && owner.rol === 'SUPER_ADMIN' && owner.aktifMi)
      record('düz parola DB’de yok', !!owner && !JSON.stringify(owner).includes(password))

      const otherAktif = await prisma.superAdmin.count({
        where: { aktifMi: true, NOT: { id: owner!.id } }
      })
      record('diğer aktif admin yok', otherAktif === 0)

      const openSessions = await prisma.adminRefreshSession.count({
        where: { revokedAt: null, adminId: { not: owner!.id } }
      })
      // Diğer adminlerin açık session’ı olmamalı; owner’ın da bootstrap’ta revoke edildi
      record('diğer admin refresh session iptal', openSessions === 0)

      const loginOk = await jsonFetch(API, '/api/v1/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: normalizeEmail(email), sifre: password })
      })
      record('doğru parola admin login', loginOk.status === 200)
      const adminToken = (loginOk.body as { adminAccessToken?: string } | null)?.adminAccessToken
      if (adminToken) {
        const me = await jsonFetch(API, '/api/v1/admin/me', {
          headers: { Authorization: `Bearer ${adminToken}` }
        })
        record('admin/me SUPER_ADMIN', me.status === 200)
        const dash = await jsonFetch(API, '/api/v1/admin/dashboard', {
          headers: { Authorization: `Bearer ${adminToken}` }
        })
        record('admin dashboard SUPER_ADMIN', dash.status === 200)
      }

      const loginBad = await jsonFetch(API, '/api/v1/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: normalizeEmail(email), sifre: 'YanlisParola_X9!' })
      })
      record('yanlış parola login başarısız', loginBad.status === 401 || loginBad.status === 403)

      // Pasif admin token reddi: geçici pasif admin oluştur → token üret → requireAdminAuth yolu
      const passive = await prisma.superAdmin.create({
        data: {
          adSoyad: 'Quality Passive',
          kullaniciAdi: `q_passive_${Date.now().toString(36)}`,
          eposta: `q.passive.${Date.now()}@example.invalid`,
          sifreHash: await bcrypt.hash('UnusedPass_Quality1!', BCRYPT_COST),
          rol: 'DESTEK',
          aktifMi: false
        }
      })
      const passiveToken = signAdminAccessToken({
        adminId: passive.id,
        role: 'DESTEK',
        kullaniciAdi: passive.kullaniciAdi
      })
      const denied = await jsonFetch(API, '/api/v1/admin/dashboard', {
        headers: { Authorization: `Bearer ${passiveToken}` }
      })
      record('pasif admin access token API reddi', denied.status === 401 || denied.status === 403)

      const destekAktif = await prisma.superAdmin.create({
        data: {
          adSoyad: 'Quality Destek',
          kullaniciAdi: `q_destek_${Date.now().toString(36)}`,
          eposta: `q.destek.${Date.now()}@example.invalid`,
          sifreHash: await bcrypt.hash('UnusedPass_Quality1!', BCRYPT_COST),
          rol: 'DESTEK',
          aktifMi: true
        }
      })
      const destekToken = signAdminAccessToken({
        adminId: destekAktif.id,
        role: 'DESTEK',
        kullaniciAdi: destekAktif.kullaniciAdi
      })
      const destDenied = await jsonFetch(API, '/api/v1/admin/dashboard', {
        headers: { Authorization: `Bearer ${destekToken}` }
      })
      record('DESTEK rolü dashboard 403', destDenied.status === 403)

      // Linked User tek giriş: geçici tenant user + linkedUserId
      const linkedEmail = `q.linked.${Date.now()}@example.invalid`
      const linkedPass = 'LinkedQualityPass1!'
      const tenant = await prisma.tenant.findFirst({ select: { id: true } })
      if (tenant) {
        const linkedUser = await prisma.user.create({
          data: {
            tenantId: tenant.id,
            adSoyad: 'Quality Linked',
            kullaniciAdi: `q_linked_${Date.now().toString(36)}`,
            eposta: linkedEmail,
            sifreHash: await bcrypt.hash(linkedPass, BCRYPT_COST),
            role: 'BURO_SAHIBI',
            aktifMi: true,
            licenseActivatedAt: new Date(),
            mustChangePassword: false
          }
        })
        await prisma.superAdmin.update({
          where: { id: owner!.id },
          data: { linkedUserId: linkedUser.id }
        })

        const linkedLogin = await jsonFetch(API, '/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier: linkedEmail, sifre: linkedPass })
        })
        const linkedBody = linkedLogin.body as {
          accessToken?: string
          adminAccessToken?: string
          adminUser?: { rol?: string }
        } | null
        record('linked tenant login 200', linkedLogin.status === 200)
        record('linked login adminAccessToken döner', !!linkedBody?.adminAccessToken)
        record('linked login adminUser SUPER_ADMIN', linkedBody?.adminUser?.rol === 'SUPER_ADMIN')

        const sameEmailNoLink = await prisma.user.create({
          data: {
            tenantId: tenant.id,
            adSoyad: 'Same Email No Link',
            kullaniciAdi: `q_nolink_${Date.now().toString(36)}`,
            eposta: `nolink.${Date.now()}@example.invalid`,
            sifreHash: await bcrypt.hash(linkedPass, BCRYPT_COST),
            role: 'BURO_SAHIBI',
            aktifMi: true,
            licenseActivatedAt: new Date(),
            mustChangePassword: false
          }
        })
        // Sahte: owner e-postasını kopyalama yetmez — linkedUserId yok
        const noLinkLogin = await jsonFetch(API, '/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            identifier: sameEmailNoLink.eposta,
            sifre: linkedPass
          })
        })
        const noLinkBody = noLinkLogin.body as { adminAccessToken?: string } | null
        record('linkedUserId yoksa adminAccessToken yok', noLinkLogin.status === 200 && !noLinkBody?.adminAccessToken)

        await prisma.superAdmin.update({
          where: { id: owner!.id },
          data: { linkedUserId: null, aktifMi: false }
        })
        const passiveLinkedLogin = await jsonFetch(API, '/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier: linkedEmail, sifre: linkedPass })
        })
        const passiveBody = passiveLinkedLogin.body as { adminAccessToken?: string } | null
        record(
          'pasif SuperAdmin linked login admin yok',
          passiveLinkedLogin.status === 200 && !passiveBody?.adminAccessToken
        )

        await prisma.user.updateMany({
          where: { id: { in: [linkedUser.id, sameEmailNoLink.id] } },
          data: { aktifMi: false }
        })
      } else {
        record('linked login senaryosu', false, 'tenant yok')
      }

      // Temizlik: quality temp adminleri pasife al + owner tek aktif kalsın
      await prisma.superAdmin.updateMany({
        where: { id: { in: [passive.id, destekAktif.id] } },
        data: { aktifMi: false }
      })
      await bootstrapOwnerAdmin(prisma, {
        email,
        password,
        adSoyad: process.env.ADMIN_BOOTSTRAP_AD_SOYAD?.trim() || 'Woontegra Süper Admin'
      })
      await prisma.superAdmin.update({
        where: { id: owner!.id },
        data: { linkedUserId: null }
      })
    } finally {
      ;(process.env as { ADMIN_BOOTSTRAP_PASSWORD?: string }).ADMIN_BOOTSTRAP_PASSWORD = undefined
      await prisma.$disconnect()
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.info(`\n[admin-owner-quality] ${results.length - failed.length}/${results.length} geçti`)
  if (failed.length) {
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
