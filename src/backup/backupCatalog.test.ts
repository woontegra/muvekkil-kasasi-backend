import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import express from 'express'
import {
  backupCatalogWhere,
  buildBackupIndex,
  buildCatalogResponse,
  createBackupCatalogLoader,
  matchesBackupCatalogQuery,
  presenceFor,
  type CatalogTenantRow
} from './backupCatalog.js'
import { createBackupCatalogRouter } from './backupCatalogRoutes.js'
import { loadBackupListEnv } from './backupEnv.js'
import { BackupConfigError } from './backupErrors.js'
import { manifestObjectKey, snapshotObjectKey } from './backupObjectKey.js'
import type { BackupObjectHead } from './backupStore.js'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const TENANT_DEMO = '33333333-3333-4333-8333-333333333333'
const TENANT_PASSIVE = '44444444-4444-4444-8444-444444444444'
const TENANT_EXPIRED = '55555555-5555-4555-8555-555555555555'
const PII_EMAIL = 'gizli-musteri@example.com'
const PII_PHONE = '+905551112233'
const PII_NAME = 'Gizli Buro Unvani'

function row(partial: Partial<CatalogTenantRow> & Pick<CatalogTenantRow, 'tenantId' | 'buroAdi'>): CatalogTenantRow {
  return {
    kullaniciAdi: null,
    sahipAdSoyad: null,
    eposta: null,
    lisansDurumu: 'AKTIF',
    demoMu: false,
    ...partial
  }
}

function head(key: string, lastModified: string | null): BackupObjectHead {
  return { key, lastModified }
}

const heads: BackupObjectHead[] = [
  head(snapshotObjectKey(TENANT_A, '2026-10-05'), '2026-10-05T21:00:00.000Z'),
  head(manifestObjectKey(TENANT_A, '2026-10-05'), '2026-10-05T21:01:00.000Z'),
  head(snapshotObjectKey(TENANT_A, '2026-10-06'), '2026-10-06T01:00:00.000Z'),
  head(snapshotObjectKey(TENANT_B, '2026-10-06'), '2026-10-06T02:00:00.000Z'),
  head(manifestObjectKey(TENANT_B, '2026-10-06'), '2026-10-06T02:05:00.000Z'),
  head(snapshotObjectKey(TENANT_DEMO, '2026-10-07'), '2026-10-07T03:00:00.000Z'),
  head(manifestObjectKey(TENANT_DEMO, '2026-10-07'), '2026-10-07T03:01:00.000Z'),
  head(`tenants/${PII_EMAIL}/daily/2026-10-06/snapshot.json.gz.enc`, '2026-10-06T04:00:00.000Z'),
  head(`tenants/${TENANT_A}/daily/2026-10-06/${PII_PHONE}.json`, '2026-10-06T04:01:00.000Z'),
  head(`tenants/${TENANT_A}/notes.txt`, '2026-10-06T04:02:00.000Z')
]

const tenants: CatalogTenantRow[] = [
  row({
    tenantId: TENANT_A,
    buroAdi: PII_NAME,
    kullaniciAdi: 'gizli.buro',
    sahipAdSoyad: 'Ayse Yilmaz',
    eposta: PII_EMAIL,
    lisansDurumu: 'AKTIF'
  }),
  row({
    tenantId: TENANT_B,
    buroAdi: 'Beta Hukuk',
    kullaniciAdi: 'beta.buro',
    sahipAdSoyad: 'Beta Sahip',
    eposta: 'beta@example.com',
    lisansDurumu: 'AKTIF'
  }),
  row({
    tenantId: TENANT_DEMO,
    buroAdi: 'Demo Ofis',
    eposta: 'demo@example.com',
    lisansDurumu: 'AKTIF',
    demoMu: true
  }),
  row({
    tenantId: TENANT_PASSIVE,
    buroAdi: 'Pasif Ofis',
    eposta: 'pasif@example.com',
    lisansDurumu: 'PASIF'
  }),
  row({
    tenantId: TENANT_EXPIRED,
    buroAdi: 'Suresi Dolan Ofis',
    eposta: 'suresi@example.com',
    lisansDurumu: 'SURESI_DOLDU'
  }),
  row({
    tenantId: '66666666-6666-4666-8666-666666666666',
    buroAdi: 'Lisans Demo',
    eposta: 'lisans-demo@example.com',
    lisansDurumu: 'DEMO',
    demoMu: false
  })
]

function pageRows(source: CatalogTenantRow[], q?: string, page = 1, limit = 20) {
  const filtered = source.filter((item) => matchesBackupCatalogQuery(item, q))
  const start = (page - 1) * limit
  return { total: filtered.length, rows: filtered.slice(start, start + limit) }
}

describe('backup catalog', () => {
  it('does not show tenant A objects under tenant B', () => {
    const index = buildBackupIndex(heads)
    const page = buildCatalogResponse({
      rows: pageRows(tenants).rows,
      total: pageRows(tenants).total,
      page: 1,
      limit: 20,
      eligibleIds: tenants.filter((item) => matchesBackupCatalogQuery(item)).map((item) => item.tenantId),
      index
    })
    const a = page.items.find((item) => item.tenantId === TENANT_A)
    const b = page.items.find((item) => item.tenantId === TENANT_B)
    assert.ok(a)
    assert.ok(b)
    assert.equal(a.backupCount, 2)
    assert.equal(a.oldestBackupDate, '2026-10-05')
    assert.equal(a.lastSuccessfulBackupDate, '2026-10-05')
    assert.equal(a.lastBackupStatus, 'EKSIK')
    assert.equal(b.backupCount, 1)
    assert.equal(b.oldestBackupDate, '2026-10-06')
    assert.equal(b.lastSuccessfulBackupDate, '2026-10-06')
    assert.equal(b.lastBackupStatus, 'BASARILI')
    assert.equal(presenceFor(index, TENANT_A).backupCount, 2)
    assert.equal(presenceFor(index, TENANT_B).lastSuccessfulBackupDate, '2026-10-06')
    assert.notEqual(a.lastSuccessfulBackupDate, b.lastSuccessfulBackupDate)
  })

  it('matches a tenant uuid to that user only', () => {
    const index = buildBackupIndex(heads)
    const page = buildCatalogResponse({
      rows: [tenants[0]],
      total: 1,
      page: 1,
      limit: 20,
      eligibleIds: [TENANT_A],
      index
    })
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0]?.tenantId, TENANT_A)
    assert.equal(page.items[0]?.buroAdi, PII_NAME)
    assert.equal(page.items[0]?.eposta, PII_EMAIL)
    assert.equal(page.items[0]?.kullaniciAdi, 'gizli.buro')
    assert.equal(JSON.stringify(page).includes(TENANT_B), false)
  })

  it('hides demo tenants and keeps passive or expired customers', () => {
    const index = buildBackupIndex(heads)
    const eligible = tenants.filter((item) => matchesBackupCatalogQuery(item))
    const page = buildCatalogResponse({
      rows: tenants,
      total: eligible.length,
      page: 1,
      limit: 20,
      eligibleIds: eligible.map((item) => item.tenantId),
      index
    })
    const ids = page.items.map((item) => item.tenantId)
    assert.equal(ids.includes(TENANT_DEMO), false)
    assert.equal(ids.includes('66666666-6666-4666-8666-666666666666'), false)
    assert.equal(ids.includes(TENANT_PASSIVE), true)
    assert.equal(ids.includes(TENANT_EXPIRED), true)
    const passive = page.items.find((item) => item.tenantId === TENANT_PASSIVE)
    assert.equal(passive?.lastBackupStatus, 'YOK')
    assert.equal(passive?.lisansDurumu, 'PASIF')
    assert.equal(page.summary.lastRunDate, '2026-10-06')
    assert.equal(page.summary.successCount, 1)
    assert.equal(page.summary.failedCount, eligible.length - 1)
    assert.equal(page.summary.eligibleCount, eligible.length)
    assert.equal(page.summary.lastRunAt, '2026-10-06T02:05:00.000Z')
  })

  it('searches by name, email, and uuid and paginates', () => {
    const many: CatalogTenantRow[] = Array.from({ length: 25 }, (_, i) =>
      row({
        tenantId: `77777777-7777-4777-8777-${String(i).padStart(12, '0')}`,
        buroAdi: `Buro ${String(i).padStart(2, '0')}`,
        eposta: `kisi${i}@example.com`,
        kullaniciAdi: `kullanici${i}`
      })
    )
    const byName = pageRows(many, 'buro 03', 1, 20)
    assert.equal(byName.total, 1)
    assert.equal(byName.rows[0]?.buroAdi, 'Buro 03')
    const byEmail = pageRows(many, 'kisi19@example.com')
    assert.equal(byEmail.total, 1)
    assert.equal(byEmail.rows[0]?.tenantId.endsWith('000000000019'), true)
    const byUuid = pageRows(many, '77777777-7777-4777-8777-000000000007')
    assert.equal(byUuid.total, 1)
    assert.equal(byUuid.rows[0]?.buroAdi, 'Buro 07')
    const page3 = pageRows(many, undefined, 3, 10)
    assert.equal(page3.total, 25)
    assert.equal(page3.rows.length, 5)
    assert.equal(page3.rows[0]?.buroAdi, 'Buro 20')
    const where = backupCatalogWhere('Beta')
    const encoded = JSON.stringify(where)
    assert.equal(encoded.includes('demoMu'), true)
    assert.equal(encoded.includes('DEMO'), true)
    assert.equal(encoded.includes('buroAdi'), true)
    assert.equal(encoded.includes('eposta'), true)
    assert.equal(encoded.includes('"id"'), true)
  })

  it('ignores object keys that are not uuid daily backups', () => {
    const index = buildBackupIndex(heads)
    assert.equal(index.has(PII_EMAIL), false)
    assert.equal(index.has(PII_PHONE), false)
    const encoded = JSON.stringify([...index.keys()])
    assert.equal(encoded.includes('@'), false)
    assert.equal(encoded.includes(PII_PHONE), false)
    assert.equal(encoded.includes(PII_NAME), false)
    assert.throws(() => snapshotObjectKey(PII_EMAIL, '2026-10-06'))
    for (const item of heads) {
      if (!item.key.startsWith('tenants/') || !item.key.includes('/daily/')) continue
      if (item.key.includes(PII_EMAIL) || item.key.includes(PII_PHONE)) {
        assert.equal(BACKUP_KEY_ACCEPTED(item.key), false)
      }
    }
  })

  it('lists each tenant prefix once per cache window', async () => {
    let lists = 0
    let clock = 1_000
    const loader = createBackupCatalogLoader({
      ttlMs: 60_000,
      now: () => clock,
      listHeads: async () => {
        lists += 1
        return heads
      },
      readEligibleIds: async () => [TENANT_A, TENANT_B],
      readPage: async (query) => pageRows(tenants, query.q, query.page, query.limit)
    })
    await loader.load({ page: 1, limit: 20 })
    await loader.load({ q: 'beta', page: 1, limit: 20 })
    await loader.load({ page: 2, limit: 20 })
    assert.equal(lists, 1)
    clock += 60_000
    await loader.load({ page: 1, limit: 20 })
    assert.equal(lists, 2)
  })

  it('refuses the catalog unless the caller is a super admin', async () => {
    let loads = 0
    const app = express()
    app.use(
      '/api/v1/admin/backups',
      createBackupCatalogRouter({
        requireAuth: (req, res, next) => {
          if (!req.header('x-test-role')) {
            res.status(401).json({ error: 'ADMIN_UNAUTHORIZED' })
            return
          }
          next()
        },
        requireSuper: (req, res, next) => {
          if (req.header('x-test-role') !== 'SUPER_ADMIN') {
            res.status(403).json({ error: 'ADMIN_FORBIDDEN' })
            return
          }
          next()
        },
        load: async () => {
          loads += 1
          return { items: [], total: 0, page: 1, limit: 20, summary: { eligibleCount: 0 } }
        }
      })
    )
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const anonymous = await fetch(`http://127.0.0.1:${port}/api/v1/admin/backups`)
      assert.equal(anonymous.status, 401)
      const destek = await fetch(`http://127.0.0.1:${port}/api/v1/admin/backups`, {
        headers: { 'x-test-role': 'DESTEK' }
      })
      assert.equal(destek.status, 403)
      const finans = await fetch(`http://127.0.0.1:${port}/api/v1/admin/backups`, {
        headers: { 'x-test-role': 'FINANS' }
      })
      assert.equal(finans.status, 403)
      assert.equal(loads, 0)
      const ok = await fetch(`http://127.0.0.1:${port}/api/v1/admin/backups?page=1&limit=20`, {
        headers: { 'x-test-role': 'SUPER_ADMIN' }
      })
      assert.equal(ok.status, 200)
      assert.equal(loads, 1)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    }

    const guarded = express()
    guarded.use(
      '/api/v1/admin/backups',
      createBackupCatalogRouter({
        requireAuth: (_req, _res, next) => next(),
        requireSuper: (_req, _res, next) => next(),
        load: async () => {
          throw new BackupConfigError('BACKUP_ENV_MISSING', ['R2_BUCKET'])
        }
      })
    )
    const guardedServer = createServer(guarded)
    await new Promise<void>((resolve) => guardedServer.listen(0, '127.0.0.1', () => resolve()))
    const guardedAddress = guardedServer.address()
    const guardedPort = typeof guardedAddress === 'object' && guardedAddress ? guardedAddress.port : 0
    try {
      const missing = await fetch(`http://127.0.0.1:${guardedPort}/api/v1/admin/backups`, {
        headers: { 'x-test-role': 'SUPER_ADMIN' }
      })
      const body = (await missing.json()) as { error?: string }
      assert.equal(missing.status, 503)
      assert.equal(body.error, 'BACKUP_ENV_MISSING')
      assert.equal(JSON.stringify(body).includes('R2_'), false)
    } finally {
      await new Promise<void>((resolve, reject) => guardedServer.close((err) => (err ? reject(err) : resolve())))
    }

    const here = path.dirname(fileURLToPath(import.meta.url))
    const routes = fs.readFileSync(path.resolve(here, '../admin/admin.routes.ts'), 'utf8')
    assert.match(routes, /createBackupCatalogRouter\(\{/)
    assert.match(routes, /requireAuth:\s*requireAdminAuth/)
    assert.match(routes, /requireSuper:\s*superOnly/)
    assert.match(routes, /const superOnly = requireAdminRoles\('SUPER_ADMIN'\)/)
  })

  it('does not write tenant or backup rows', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const files = ['backupCatalog.ts', 'backupCatalogDb.ts', 'backupCatalogRoutes.ts', 'backupR2.ts']
    const writeCall = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/
    for (const name of files) {
      const source = fs.readFileSync(path.join(here, name), 'utf8')
      assert.equal(/\$executeRaw/.test(source), false, name)
      assert.equal(/\bINSERT\s+INTO\b/i.test(source), false, name)
      assert.equal(/\bDELETE\s+FROM\b/i.test(source), false, name)
      assert.equal(/\bUPDATE\s+[a-z_]+\s+SET\b/i.test(source), false, name)
      assert.equal(writeCall.test(source), false, name)
    }
    const db = fs.readFileSync(path.join(here, 'backupCatalogDb.ts'), 'utf8')
    assert.equal(db.includes('findMany'), true)
    assert.equal(db.includes('.count('), true)
    assert.equal(db.includes('telefon'), false)
    assert.equal(db.includes('sifreHash'), false)
    const listed = loadBackupListEnv({
      R2_ACCOUNT_ID: 'abc123',
      R2_ACCESS_KEY_ID: 'access',
      R2_SECRET_ACCESS_KEY: 'secret-value',
      R2_BUCKET: 'woontegra-disaster-backups',
      R2_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com'
    })
    assert.equal('encryptionKey' in listed, false)
    assert.equal(JSON.stringify(listed).includes('BACKUP_ENCRYPTION_KEY'), false)
    const run = fs.readFileSync(path.join(here, 'backupRun.ts'), 'utf8')
    assert.equal(run.includes('getBackupCatalog'), false)
    assert.equal(run.includes('backupCatalog'), false)
  })
})

function BACKUP_KEY_ACCEPTED(key: string): boolean {
  return /^tenants\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/daily\/\d{4}-\d{2}-\d{2}\/(snapshot\.json\.gz\.enc|manifest\.json)$/i.test(
    key
  )
}
