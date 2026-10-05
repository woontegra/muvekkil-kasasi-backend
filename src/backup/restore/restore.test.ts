import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { Prisma } from '@prisma/client'
import express from 'express'
import { buildBackupIndex, backupDaysForTenant } from '../backupCatalog.js'
import { BackupTenantError } from '../backupErrors.js'
import { buildManifest } from '../backupManifest.js'
import { manifestObjectKey, snapshotObjectKey } from '../backupObjectKey.js'
import { packSnapshot } from '../backupPack.js'
import { selectRetentionDeletes } from '../backupRetention.js'
import type { TenantSnapshotPayload } from '../backupExport.js'
import { BACKUP_TABLES, EXCLUDED_BACKUP_MODELS } from '../backupTables.js'
import { applyRestoreSnapshot, type RestoreWriter } from './restoreApply.js'
import { coerceRestoreRow } from './restoreCoerce.js'
import { assertDailyBackupKey, preRestoreObjectKeys } from './restoreKeys.js'
import { orderRestoreRows, restoreDeleteOrder, restoreForeignKeys, restoreInsertOrder } from './restoreOrder.js'
import { createBackupRestoreRouter } from './restoreRoutes.js'
import { runTenantRestore, type RestoreObjectStore, type RestoreTenantRecord } from './restoreService.js'

const KEY = 'unit-test-backup-key-0123456789abcdef'
const FP = 'ab'.repeat(32)
const DAY = '2026-10-06'
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const USER_A = '33333333-3333-4333-8333-333333333333'
const USER_B = '44444444-4444-4444-8444-444444444444'
const USER_EXTRA = '99999999-9999-4999-8999-999999999999'
const MU_OLD = '55555555-5555-4555-8555-555555555555'
const MU_NEW = '66666666-6666-4666-8666-666666666666'
const MU_B = '77777777-7777-4777-8777-777777777777'
const NOW = new Date('2026-10-06T12:00:00.000Z')

type Row = Record<string, unknown>

function payload(tenantId: string, tables: Record<string, Row[]> = {}): TenantSnapshotPayload {
  const all: Record<string, Row[]> = {}
  for (const spec of BACKUP_TABLES) all[spec.delegate] = tables[spec.delegate] ?? []
  return {
    format: 'mk-tenant-backup',
    formatVersion: 1,
    schemaFingerprint: FP,
    tenantId,
    capturedAt: '2026-10-06T12:00:00.000Z',
    timezone: 'Europe/Istanbul',
    calendarDate: DAY,
    isolation: 'RepeatableRead',
    tables: all
  }
}

function officeTables(tenantId: string, userId: string, userName: string, muvekkilId: string, muvekkilName: string, buroAdi: string): Record<string, Row[]> {
  return {
    tenant: [{ id: tenantId, buroAdi, demoMu: false, lisansDurumu: 'AKTIF' }],
    user: [{ id: userId, tenantId, adSoyad: userName }],
    muvekkil: [{ id: muvekkilId, tenantId, createdById: userId, adSoyad: muvekkilName }]
  }
}

class MemStore implements RestoreObjectStore {
  objects = new Map<string, Buffer>()
  puts: string[] = []
  gets = 0
  failSafety = false
  async getObject(key: string): Promise<Buffer | null> {
    this.gets += 1
    return this.objects.get(key) ?? null
  }
  async putObject(key: string, body: Buffer): Promise<void> {
    if (this.failSafety && key.includes('/pre-restore/')) throw new Error('upload failed secret-value gizli@example.com')
    this.puts.push(key)
    this.objects.set(key, body)
  }
}

function storeDaily(store: MemStore, tenantId: string, body: TenantSnapshotPayload): void {
  const packed = packSnapshot(body, KEY)
  const manifest = buildManifest({
    tenantId: body.tenantId,
    calendarDate: body.calendarDate,
    capturedAt: body.capturedAt,
    schemaFingerprint: body.schemaFingerprint,
    rowCounts: packed.rowCounts,
    snapshotSha256: packed.sha256,
    snapshotBytes: packed.ciphertext.length
  })
  store.objects.set(snapshotObjectKey(tenantId, body.calendarDate), packed.ciphertext)
  store.objects.set(manifestObjectKey(tenantId, body.calendarDate), Buffer.from(JSON.stringify(manifest), 'utf8'))
}

class MemoryDb {
  rows = new Map<string, Row[]>()
  failOn: string | null = null
  writes = 0

  seed(delegate: string, rows: Row[]): void {
    this.rows.set(delegate, rows.map((row) => ({ ...row })))
  }

  dump(): string {
    const obj: Record<string, Row[]> = {}
    for (const [key, rows] of [...this.rows.entries()].sort()) obj[key] = rows
    return JSON.stringify(obj)
  }

  writer(): RestoreWriter {
    const db = this
    const allowed = new Set(BACKUP_TABLES.map((spec) => spec.delegate))
    return {
      async lockTenant() {},
      async listIds(delegate, tenantId) {
        if (!allowed.has(delegate)) throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
        return (db.rows.get(delegate) ?? []).filter((row) => row.tenantId === tenantId).map((row) => String(row.id))
      },
      async deleteSlice(delegate, tenantId) {
        const spec = BACKUP_TABLES.find((item) => item.delegate === delegate)
        if (!spec || spec.model === 'User' || spec.scope !== 'tenantId') {
          throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
        }
        db.writes += 1
        db.rows.set(
          delegate,
          (db.rows.get(delegate) ?? []).filter((row) => row.tenantId !== tenantId)
        )
      },
      async guardUserDeletes() {},
      async deleteOwnedUser(tenantId, id) {
        db.writes += 1
        const before = db.rows.get('user') ?? []
        const next = before.filter((row) => !(row.id === id && row.tenantId === tenantId))
        if (next.length !== before.length - 1) throw new BackupTenantError('RESTORE_ROW_MISSING', 'restore')
        db.rows.set('user', next)
      },
      async updateOwned(delegate, tenantId, id, data) {
        if (delegate !== 'tenant' && delegate !== 'user') throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
        db.writes += 1
        const rows = db.rows.get(delegate) ?? []
        const index = rows.findIndex((row) => row.id === id && (delegate === 'tenant' ? id === tenantId : row.tenantId === tenantId))
        if (index < 0) throw new BackupTenantError('RESTORE_ROW_MISSING', 'restore')
        rows[index] = { ...data, id, ...(delegate === 'user' ? { tenantId } : {}) }
      },
      async insertOwned(delegate, tenantId, data) {
        const spec = BACKUP_TABLES.find((item) => item.delegate === delegate)
        if (!spec || spec.scope !== 'tenantId') throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
        if (String(data.tenantId) !== tenantId) throw new BackupTenantError('RESTORE_FOREIGN_TENANT', 'restore')
        if (db.failOn === delegate) throw new Error('mid-restore')
        db.writes += 1
        const id = String(data.id)
        for (const rows of db.rows.values()) {
          if (rows.some((row) => row.id === id)) throw new BackupTenantError('RESTORE_CONFLICT', 'restore')
        }
        const list = db.rows.get(delegate) ?? []
        list.push({ ...data, id, tenantId })
        db.rows.set(delegate, list)
      }
    }
  }

  async transaction(fn: (writer: RestoreWriter) => Promise<void>): Promise<void> {
    const before = new Map([...this.rows.entries()].map(([key, rows]) => [key, rows.map((row) => ({ ...row }))]))
    const writes = this.writes
    try {
      await fn(this.writer())
    } catch (err) {
      this.rows = before
      this.writes = writes
      throw err
    }
  }
}

function seedOffices(db: MemoryDb): void {
  db.seed('tenant', [
    { id: A, buroAdi: 'A Ofis', demoMu: false, lisansDurumu: 'AKTIF' },
    { id: B, buroAdi: 'B Ofis', demoMu: false, lisansDurumu: 'AKTIF' }
  ])
  db.seed('user', [
    { id: USER_A, tenantId: A, adSoyad: 'Eski Kullanici' },
    { id: USER_EXTRA, tenantId: A, adSoyad: 'Silinecek' },
    { id: USER_B, tenantId: B, adSoyad: 'B Kullanici' }
  ])
  db.seed('muvekkil', [
    { id: MU_OLD, tenantId: A, createdById: USER_A, adSoyad: 'Eski Muvekkil' },
    { id: MU_B, tenantId: B, createdById: USER_B, adSoyad: 'B Muvekkil' }
  ])
}

function tenantRecord(id: string, buroAdi: string, demoMu = false, lisansDurumu = 'AKTIF'): RestoreTenantRecord {
  return { id, buroAdi, demoMu, lisansDurumu }
}

describe('tenant restore v1', () => {
  it('keeps restore order aligned with backup models and foreign keys', () => {
    const insert = restoreInsertOrder()
    const remove = restoreDeleteOrder()
    assert.equal(insert.length, BACKUP_TABLES.length)
    assert.deepEqual(new Set(insert), new Set(BACKUP_TABLES.map((spec) => spec.model)))
    for (const name of EXCLUDED_BACKUP_MODELS) assert.equal(insert.includes(name), false)
    assert.equal(remove.includes('Tenant'), false)
    assert.equal(remove.includes('User'), false)
    for (const key of restoreForeignKeys()) {
      if (key.parent === key.model) continue
      assert.ok(insert.indexOf(key.parent) < insert.indexOf(key.model), key.field)
      if (key.parent === 'Tenant' || key.parent === 'User') {
        if (key.model !== 'User') assert.equal(remove.includes(key.model), true, key.model)
      } else {
        assert.ok(remove.indexOf(key.model) < remove.indexOf(key.parent), key.field)
      }
    }
    const ordered = orderRestoreRows('KasaHareketi', [
      { id: 'child', orijinalHareketId: 'parent' },
      { id: 'parent', orijinalHareketId: null }
    ])
    assert.equal(ordered[0]?.id, 'parent')
    assert.throws(() =>
      orderRestoreRows('KasaHareketi', [
        { id: 'a', orijinalHareketId: 'b' },
        { id: 'b', orijinalHareketId: 'a' }
      ])
    )
  })

  it('restores tenant A without changing tenant B', async () => {
    const db = new MemoryDb()
    seedOffices(db)
    const beforeB = JSON.stringify({
      user: db.rows.get('user')?.filter((row) => row.tenantId === B),
      muvekkil: db.rows.get('muvekkil')?.filter((row) => row.tenantId === B),
      tenant: db.rows.get('tenant')?.filter((row) => row.id === B)
    })
    const store = new MemStore()
    const restored = payload(A, {
      ...officeTables(A, USER_A, 'Yeni Kullanici', MU_NEW, 'Geri Gelen', 'A Ofis')
    })
    storeDaily(store, A, restored)
    const result = await runTenantRestore(
      {
        now: NOW,
        encryptionKey: KEY,
        schemaFingerprint: FP,
        store,
        readTenant: async () => tenantRecord(A, 'A Ofis'),
        exportTenant: async () => ({ kind: 'ok', payload: payload(A, officeTables(A, USER_A, 'Eski Kullanici', MU_OLD, 'Eski Muvekkil', 'A Ofis')) }),
        apply: (snapshot) => db.transaction((writer) => applyRestoreSnapshot(writer, snapshot, A))
      },
      { tenantId: A, calendarDate: DAY, confirmBuroAdi: 'A Ofis' }
    )
    const usersA = db.rows.get('user')?.filter((row) => row.tenantId === A) ?? []
    const muvekkilA = db.rows.get('muvekkil')?.filter((row) => row.tenantId === A) ?? []
    assert.deepEqual(usersA.map((row) => row.id).sort(), [USER_A])
    assert.equal(usersA[0]?.adSoyad, 'Yeni Kullanici')
    assert.deepEqual(muvekkilA.map((row) => row.adSoyad), ['Geri Gelen'])
    assert.equal(JSON.stringify({
      user: db.rows.get('user')?.filter((row) => row.tenantId === B),
      muvekkil: db.rows.get('muvekkil')?.filter((row) => row.tenantId === B),
      tenant: db.rows.get('tenant')?.filter((row) => row.id === B)
    }), beforeB)
    assert.equal(result.calendarDate, DAY)
    assert.equal(result.restoredAt, NOW.toISOString())
    const safety = preRestoreObjectKeys(A, result.safetyStamp)
    assert.match(safety.snapshotKey, /^tenants\/[0-9a-f-]{36}\/pre-restore\/\d{8}T\d{6}\d{3}Z\/snapshot\.json\.gz\.enc$/)
    assert.equal(safety.snapshotKey.includes('@'), false)
    assert.equal(safety.snapshotKey.includes('A Ofis'), false)
    assert.equal(store.puts.includes(safety.snapshotKey), true)
    assert.equal(store.puts.includes(safety.manifestKey), true)
    const doomed = selectRetentionDeletes(
      [safety.snapshotKey, safety.manifestKey, snapshotObjectKey(B, '2026-09-01'), snapshotObjectKey(A, DAY)],
      A,
      DAY
    )
    assert.equal(doomed.includes(safety.snapshotKey), false)
    assert.equal(doomed.includes(safety.manifestKey), false)
    assert.equal(doomed.includes(snapshotObjectKey(B, '2026-09-01')), false)
    const days = backupDaysForTenant(
      buildBackupIndex([
        { key: snapshotObjectKey(A, DAY), lastModified: NOW.toISOString() },
        { key: manifestObjectKey(A, DAY), lastModified: NOW.toISOString() },
        { key: snapshotObjectKey(B, '2026-10-01'), lastModified: NOW.toISOString() },
        { key: safety.snapshotKey, lastModified: NOW.toISOString() }
      ]),
      A
    )
    assert.equal(days.length, 1)
    assert.equal(days[0]?.calendarDate, DAY)
    assert.equal(JSON.stringify(days).includes(B), false)
  })

  it('rejects a snapshot or object key that belongs to another tenant', async () => {
    const store = new MemStore()
    storeDaily(store, A, payload(B, officeTables(B, USER_B, 'B', MU_B, 'B Muvekkil', 'B Ofis')))
    let applied = 0
    await assert.rejects(
      () =>
        runTenantRestore(
          {
            now: NOW,
            encryptionKey: KEY,
            schemaFingerprint: FP,
            store,
            readTenant: async () => tenantRecord(A, 'A Ofis'),
            exportTenant: async () => ({ kind: 'ok', payload: payload(A) }),
            apply: async () => {
              applied += 1
            }
          },
          { tenantId: A, calendarDate: DAY, confirmBuroAdi: 'A Ofis' }
        ),
      (err: unknown) => err instanceof BackupTenantError && err.code === 'RESTORE_TENANT_MISMATCH'
    )
    const foreignRow = payload(A, {
      ...officeTables(A, USER_A, 'A', MU_NEW, 'X', 'A Ofis'),
      muvekkil: [{ id: MU_NEW, tenantId: B, createdById: USER_A, adSoyad: 'Baska' }]
    })
    storeDaily(store, A, foreignRow)
    await assert.rejects(
      () =>
        runTenantRestore(
          {
            now: NOW,
            encryptionKey: KEY,
            schemaFingerprint: FP,
            store,
            readTenant: async () => tenantRecord(A, 'A Ofis'),
            exportTenant: async () => ({ kind: 'ok', payload: payload(A) }),
            apply: async () => {
              applied += 1
            }
          },
          { tenantId: A, calendarDate: DAY, confirmBuroAdi: 'A Ofis' }
        ),
      (err: unknown) => err instanceof BackupTenantError && err.code === 'RESTORE_FOREIGN_TENANT'
    )
    const foreignRef = payload(A, {
      tenant: [{ id: A, buroAdi: 'A Ofis' }],
      user: [{ id: USER_A, tenantId: A, adSoyad: 'A' }],
      muvekkil: [{ id: MU_NEW, tenantId: A, createdById: USER_B, adSoyad: 'Disari' }]
    })
    storeDaily(store, A, foreignRef)
    await assert.rejects(
      () =>
        runTenantRestore(
          {
            now: NOW,
            encryptionKey: KEY,
            schemaFingerprint: FP,
            store,
            readTenant: async () => tenantRecord(A, 'A Ofis'),
            exportTenant: async () => ({ kind: 'ok', payload: payload(A) }),
            apply: async () => {
              applied += 1
            }
          },
          { tenantId: A, calendarDate: DAY, confirmBuroAdi: 'A Ofis' }
        ),
      (err: unknown) => err instanceof BackupTenantError && err.code === 'RESTORE_FOREIGN_REFERENCE'
    )
    assert.throws(() => assertDailyBackupKey(A, snapshotObjectKey(B, DAY)), (err: unknown) => {
      assert.ok(err instanceof BackupTenantError)
      assert.equal(err.code, 'RESTORE_OBJECT_KEY')
      return true
    })
    assert.throws(() => assertDailyBackupKey(A, `tenants/${A}/pre-restore/20261006T120000000Z/snapshot.json.gz.enc`))
    assert.throws(() => assertDailyBackupKey(A, `tenants/gizli@example.com/daily/${DAY}/snapshot.json.gz.enc`))
    assert.equal(applied, 0)
    assert.equal(store.puts.length, 0)
  })

  it('stops before restore when decrypt fails, safety upload fails, or the tenant is demo', async () => {
    const store = new MemStore()
    store.objects.set(snapshotObjectKey(A, DAY), Buffer.from('not-ciphertext'))
    store.objects.set(manifestObjectKey(A, DAY), Buffer.from('{}'))
    let applied = 0
    await assert.rejects(
      () =>
        runTenantRestore(
          {
            now: NOW,
            encryptionKey: KEY,
            schemaFingerprint: FP,
            store,
            readTenant: async () => tenantRecord(A, 'A Ofis'),
            exportTenant: async () => ({ kind: 'ok', payload: payload(A) }),
            apply: async () => {
              applied += 1
            }
          },
          { tenantId: A, calendarDate: DAY, confirmBuroAdi: 'A Ofis' }
        ),
      (err: unknown) => err instanceof BackupTenantError && err.code === 'DECRYPT_FAILED' && !err.message.includes(KEY)
    )
    assert.equal(store.puts.length, 0)

    storeDaily(store, A, payload(A, officeTables(A, USER_A, 'A', MU_NEW, 'A', 'A Ofis')))
    store.failSafety = true
    await assert.rejects(
      () =>
        runTenantRestore(
          {
            now: NOW,
            encryptionKey: KEY,
            schemaFingerprint: FP,
            store,
            readTenant: async () => tenantRecord(A, 'A Ofis'),
            exportTenant: async () => ({ kind: 'ok', payload: payload(A, officeTables(A, USER_A, 'A', MU_OLD, 'Eski', 'A Ofis')) }),
            apply: async () => {
              applied += 1
            }
          },
          { tenantId: A, calendarDate: DAY, confirmBuroAdi: 'A Ofis' }
        ),
      (err: unknown) =>
        err instanceof BackupTenantError &&
        err.code === 'RESTORE_SAFETY_BACKUP_FAILED' &&
        !err.message.includes('secret-value') &&
        !err.message.includes('@')
    )

    const demoGets = store.gets
    await assert.rejects(
      () =>
        runTenantRestore(
          {
            now: NOW,
            encryptionKey: KEY,
            schemaFingerprint: FP,
            store,
            readTenant: async () => tenantRecord(A, 'Demo Ofis', true, 'AKTIF'),
            exportTenant: async () => ({ kind: 'ok', payload: payload(A) }),
            apply: async () => {
              applied += 1
            }
          },
          { tenantId: A, calendarDate: DAY, confirmBuroAdi: 'Demo Ofis' }
        ),
      (err: unknown) => err instanceof BackupTenantError && err.code === 'RESTORE_TENANT_INELIGIBLE'
    )
    assert.equal(store.gets, demoGets)
    assert.equal(applied, 0)
  })

  it('rolls the tenant data back when restore fails midway', async () => {
    const db = new MemoryDb()
    seedOffices(db)
    const before = db.dump()
    db.failOn = 'muvekkil'
    const store = new MemStore()
    storeDaily(store, A, payload(A, officeTables(A, USER_A, 'Yeni', MU_NEW, 'Geri', 'A Ofis')))
    await assert.rejects(
      () =>
        runTenantRestore(
          {
            now: NOW,
            encryptionKey: KEY,
            schemaFingerprint: FP,
            store,
            readTenant: async () => tenantRecord(A, 'A Ofis'),
            exportTenant: async () => ({ kind: 'ok', payload: payload(A, officeTables(A, USER_A, 'Eski', MU_OLD, 'Eski', 'A Ofis')) }),
            apply: (snapshot) => db.transaction((writer) => applyRestoreSnapshot(writer, snapshot, A))
          },
          { tenantId: A, calendarDate: DAY, confirmBuroAdi: 'A Ofis' }
        ),
      (err: unknown) => err instanceof BackupTenantError && err.code === 'RESTORE_FAILED' && !err.message.includes('mid-restore')
    )
    assert.equal(db.dump(), before)
  })

  it('refuses restore unless the caller is a super admin', async () => {
    let restores = 0
    let days = 0
    const app = express()
    app.use(express.json())
    app.use(
      '/api/v1/admin/backups',
      createBackupRestoreRouter({
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
        loadDays: async () => {
          days += 1
          return { tenant: { id: A, buroAdi: 'A Ofis' }, days: [] }
        },
        restore: async () => {
          restores += 1
          return { tenantId: A, calendarDate: DAY, restoredAt: NOW.toISOString(), safetyStamp: '20261006T120000000Z' }
        }
      })
    )
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const anonymous = await fetch(`http://127.0.0.1:${port}/api/v1/admin/backups/${A}/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ calendarDate: DAY, confirmBuroAdi: 'A Ofis' })
      })
      assert.equal(anonymous.status, 401)
      for (const role of ['DESTEK', 'FINANS']) {
        const denied = await fetch(`http://127.0.0.1:${port}/api/v1/admin/backups/${A}/restore`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-test-role': role },
          body: JSON.stringify({ calendarDate: DAY, confirmBuroAdi: 'A Ofis' })
        })
        assert.equal(denied.status, 403)
        const list = await fetch(`http://127.0.0.1:${port}/api/v1/admin/backups/${A}`, {
          headers: { 'x-test-role': role }
        })
        assert.equal(list.status, 403)
      }
      assert.equal(restores, 0)
      assert.equal(days, 0)
      const ok = await fetch(`http://127.0.0.1:${port}/api/v1/admin/backups/${A}/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-role': 'SUPER_ADMIN' },
        body: JSON.stringify({ calendarDate: DAY, confirmBuroAdi: 'A Ofis' })
      })
      assert.equal(ok.status, 200)
      assert.equal(restores, 1)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    }
  })

  it('coerces backup values and does not write excluded tables', () => {
    const money = coerceRestoreRow('Tenant', { yillikUcret: '1250.55' }, 'update')
    assert.ok(money.yillikUcret instanceof Prisma.Decimal)
    const created = coerceRestoreRow('Tenant', { createdAt: '2026-10-06T00:00:00.000Z' }, 'update')
    assert.ok(created.createdAt instanceof Date)
    assert.throws(() => coerceRestoreRow('Tenant', { notAField: true }, 'update'))
    const here = path.dirname(fileURLToPath(import.meta.url))
    const files = fs.readdirSync(here).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    const banned = ['refreshSession', 'passwordResetToken', 'adminRefreshSession', 'adminAuditLog', 'unpackSnapshot']
    for (const name of files) {
      const source = fs.readFileSync(path.join(here, name), 'utf8')
      for (const word of banned) assert.equal(source.includes(word), false, `${name} ${word}`)
      assert.equal(/\bINSERT\s+INTO\b/i.test(source), false, name)
      assert.equal(/\bDELETE\s+FROM\b/i.test(source), false, name)
      assert.equal(/\bUPDATE\s+[a-z_]+\s+SET\b/i.test(source), false, name)
    }
    const db = fs.readFileSync(path.join(here, 'restoreDb.ts'), 'utf8')
    assert.equal(/superAdmin\.(create|update|delete|upsert|updateMany|deleteMany)\s*\(/.test(db), false)
    assert.equal(db.includes('superAdmin.count'), true)
    const routes = fs.readFileSync(path.resolve(here, '../../admin/admin.routes.ts'), 'utf8')
    assert.match(routes, /createBackupRestoreRouter\(\{/)
    assert.match(routes, /requireSuper:\s*superOnly/)
    const routeSource = fs.readFileSync(path.join(here, 'restoreRoutes.ts'), 'utf8')
    assert.equal(routeSource.includes('confirmBuroAdi'), true)
    assert.equal(routeSource.includes('objectKey'), false)
  })
})
