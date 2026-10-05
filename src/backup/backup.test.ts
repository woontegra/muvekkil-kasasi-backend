import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Prisma } from '@prisma/client'
import { addCalendarDays, istanbulCalendarDate, retentionKeepFrom } from './backupCalendar.js'
import { encryptBackupPayload } from './backupCrypto.js'
import { BackupConfigError } from './backupErrors.js'
import { loadBackupEnv } from './backupEnv.js'
import {
  BACKUP_TX_OPTIONS,
  readTenantSnapshot,
  type BackupDatabase,
  type BackupTx
} from './backupExport.js'
import { MANIFEST_KEYS } from './backupManifest.js'
import { buildBackupFailureMail, notifyBackupFailures } from './backupNotify.js'
import { manifestObjectKey, snapshotObjectKey } from './backupObjectKey.js'
import { unpackSnapshot } from './backupPack.js'
import { selectRetentionDeletes } from './backupRetention.js'
import { runTenantBackups, type BackupObjectStore } from './backupRun.js'
import { computeSchemaFingerprint } from './backupSchema.js'
import { BACKUP_TABLES, EXCLUDED_BACKUP_MODELS, shouldBackupTenant } from './backupTables.js'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const TENANT_C = '33333333-3333-4333-8333-333333333333'
const DEMO_FLAG = '44444444-4444-4444-8444-444444444444'
const DEMO_STATUS = '55555555-5555-4555-8555-555555555555'
const PASSIVE = '66666666-6666-4666-8666-666666666666'
const KEY = 'unit-test-backup-key-0123456789abcdef'
const OTHER_KEY = 'another-unit-test-key-0123456789abcdef'
const PII_EMAIL = 'gizli-musteri@example.com'
const PII_PHONE = '+905551112233'
const PII_HASH = '$2b$12$abcdefghijklmnopqrstuv'
const PII_NAME = 'Gizli Buro Unvani'
const NOW = new Date('2026-10-05T21:30:00.000Z')
const TODAY = '2026-10-06'
const FINGERPRINT = 'a'.repeat(64)
const here = path.dirname(fileURLToPath(import.meta.url))

type QueryLog = { delegate: string; where: Record<string, unknown> }

function baseRow(tenantId: string, delegate: string): Record<string, unknown> {
  if (delegate === 'tenant') {
    return {
      id: tenantId,
      demoMu: false,
      lisansDurumu: 'AKTIF',
      buroAdi: PII_NAME,
      eposta: PII_EMAIL,
      telefon: PII_PHONE
    }
  }
  const row: Record<string, unknown> = {
    id: `${delegate}-${tenantId}`,
    tenantId
  }
  if (delegate === 'user') row.sifreHash = PII_HASH
  if (delegate === 'kasaHareketi') {
    row.tutar = new Prisma.Decimal('1250.55')
    row.tarih = new Date('2026-01-02T00:00:00.000Z')
    row.tip = 'MASRAF'
    row.meta = { not: 'json-kolon', marker: `marker-${tenantId}` }
  }
  if (delegate === 'muvekkil') row.marker = `muvekkil-${tenantId}`
  return row
}

function makeDb(input?: {
  mutate?: (tenantId: string, delegate: string, rows: Record<string, unknown>[]) => Record<string, unknown>[]
  queries?: QueryLog[]
  txOptions?: unknown[]
  calls?: string[]
}): BackupDatabase {
  return {
    async $transaction(fn, options) {
      input?.txOptions?.push(options)
      const tx: BackupTx = {
        $queryRaw: async (strings) => {
          input?.calls?.push('set_config')
          const sql = Array.from(strings).join(' ')
          assert.match(sql, /set_config/)
          assert.match(sql, /transaction_read_only/)
          return []
        },
        delegate(name: string) {
          return {
            findMany: async (args) => {
              input?.calls?.push(`find:${name}`)
              input?.queries?.push({ delegate: name, where: args.where })
              const tenantId = String(args.where.tenantId ?? args.where.id ?? '')
              const rows = [baseRow(tenantId, name)]
              return input?.mutate ? input.mutate(tenantId, name, rows) : rows
            }
          }
        }
      }
      return fn(tx)
    }
  }
}

function seed(store: MemoryStore, key: string): void {
  store.objects.set(key, Buffer.from('old'))
}

class MemoryStore implements BackupObjectStore {
  objects = new Map<string, Buffer>()
  deleted: string[] = []
  listPrefixes: string[] = []
  failPutIncluding: string[] = []
  failList = false
  extraKeys: string[] = []

  async putObject(key: string, body: Buffer): Promise<void> {
    if (this.failPutIncluding.some((part) => key.includes(part))) throw new Error('upload failed')
    this.objects.set(key, Buffer.from(body))
  }

  async listKeys(prefix: string): Promise<string[]> {
    this.listPrefixes.push(prefix)
    if (this.failList) throw new Error('list failed')
    const own = [...this.objects.keys()].filter((key) => key.startsWith(prefix))
    return [...own, ...this.extraKeys]
  }

  async deleteKeys(keys: string[]): Promise<void> {
    this.deleted.push(...keys)
    for (const key of keys) this.objects.delete(key)
  }
}

describe('tenant backup v1', () => {
  it('covers every prisma model and excludes auth/platform tables', () => {
    const models = Prisma.dmmf.datamodel.models.map((model) => model.name).sort()
    const included = BACKUP_TABLES.map((spec) => spec.model).sort()
    const excluded = [...EXCLUDED_BACKUP_MODELS].sort()
    assert.deepEqual([...included, ...excluded].sort(), models)
    for (const name of excluded) assert.equal(included.includes(name), false)
    for (const spec of BACKUP_TABLES) {
      assert.equal(spec.delegate, spec.model.charAt(0).toLowerCase() + spec.model.slice(1))
    }
  })

  it('exports two tenants without leaking rows and keeps ids, decimals, dates and json', async () => {
    const store = new MemoryStore()
    const txOptions: unknown[] = []
    const calls: string[] = []
    const result = await runTenantBackups({
      now: NOW,
      encryptionKey: KEY,
      store,
      log: () => undefined,
      notify: async () => ({ sent: true }),
      listCandidates: async () => [
        { id: TENANT_A, demoMu: false, lisansDurumu: 'AKTIF' },
        { id: TENANT_B, demoMu: false, lisansDurumu: 'SURESI_DOLDU' }
      ],
      exportTenant: (tenantId, now) =>
        readTenantSnapshot(makeDb({ txOptions, calls }), tenantId, now, FINGERPRINT)
    })

    assert.deepEqual(result.ok, [TENANT_A, TENANT_B])
    assert.equal(result.calendarDate, TODAY)
    for (const options of txOptions) {
      assert.equal(
        (options as { isolationLevel: string }).isolationLevel,
        Prisma.TransactionIsolationLevel.RepeatableRead
      )
    }
    assert.equal(calls[0], 'set_config')
    assert.equal(calls.filter((call) => call.startsWith('find:')).length, BACKUP_TABLES.length * 2)

    const snapA = unpackSnapshot(store.objects.get(snapshotObjectKey(TENANT_A, TODAY))!, KEY)
    const snapB = unpackSnapshot(store.objects.get(snapshotObjectKey(TENANT_B, TODAY))!, KEY)
    assert.equal(JSON.stringify(snapA).includes(`muvekkil-${TENANT_B}`), false)
    assert.equal(JSON.stringify(snapB).includes(`muvekkil-${TENANT_A}`), false)
    assert.equal(snapA.tables.kasaHareketi[0]?.tutar, '1250.55')
    assert.equal(snapA.tables.kasaHareketi[0]?.tarih, '2026-01-02T00:00:00.000Z')
    assert.equal(snapA.tables.kasaHareketi[0]?.tip, 'MASRAF')
    assert.deepEqual(snapA.tables.kasaHareketi[0]?.meta, {
      not: 'json-kolon',
      marker: `marker-${TENANT_A}`
    })
    assert.equal(snapA.tables.user[0]?.id, `user-${TENANT_A}`)
    for (const spec of BACKUP_TABLES) {
      assert.equal(snapA.tables[spec.delegate]?.length, 1)
    }
  })

  it('skips demo tenants and exports a passive real tenant', async () => {
    const exported: string[] = []
    const store = new MemoryStore()
    const result = await runTenantBackups({
      now: NOW,
      encryptionKey: KEY,
      store,
      log: () => undefined,
      notify: async () => ({ sent: true }),
      listCandidates: async () => [
        { id: DEMO_FLAG, demoMu: true, lisansDurumu: 'AKTIF' },
        { id: DEMO_STATUS, demoMu: false, lisansDurumu: 'DEMO' },
        { id: PASSIVE, demoMu: false, lisansDurumu: 'PASIF' }
      ],
      exportTenant: async (tenantId, now) => {
        exported.push(tenantId)
        return readTenantSnapshot(
          makeDb({
            mutate: (id, delegate, rows) => {
              if (delegate === 'tenant') return [{ ...rows[0], id, demoMu: false, lisansDurumu: 'PASIF' }]
              return rows
            }
          }),
          tenantId,
          now,
          FINGERPRINT
        )
      }
    })

    assert.deepEqual(exported, [PASSIVE])
    assert.deepEqual(result.skippedDemo, [DEMO_FLAG, DEMO_STATUS])
    assert.deepEqual(result.ok, [PASSIVE])
    assert.equal(store.objects.has(snapshotObjectKey(DEMO_FLAG, TODAY)), false)
    assert.equal(shouldBackupTenant({ demoMu: false, lisansDurumu: 'SURESI_DOLDU' }), true)
    assert.equal(shouldBackupTenant({ demoMu: true, lisansDurumu: 'AKTIF' }), false)
  })

  it('does not upload when a foreign tenant row is present', async () => {
    const store = new MemoryStore()
    const result = await runTenantBackups({
      now: NOW,
      encryptionKey: KEY,
      store,
      log: () => undefined,
      notify: async () => ({ sent: true }),
      listCandidates: async () => [{ id: TENANT_A, demoMu: false, lisansDurumu: 'AKTIF' }],
      exportTenant: (tenantId, now) =>
        readTenantSnapshot(
          makeDb({
            mutate: (_id, delegate, rows) => {
              if (delegate === 'muvekkil') return [{ ...rows[0], tenantId: TENANT_B }]
              return rows
            }
          }),
          tenantId,
          now,
          FINGERPRINT
        )
    })
    assert.equal(result.failed[0]?.code, 'FOREIGN_TENANT_ROW')
    assert.equal(store.objects.size, 0)
    assert.equal(store.listPrefixes.length, 0)
  })

  it('reads inside one RepeatableRead transaction and filters every table by tenant', async () => {
    const calls: string[] = []
    const txOptions: unknown[] = []
    const queries: QueryLog[] = []
    const snapshot = await readTenantSnapshot(makeDb({ calls, txOptions, queries }), TENANT_A, NOW, FINGERPRINT)
    assert.equal(snapshot.kind, 'ok')
    assert.equal(calls[0], 'set_config')
    assert.deepEqual(txOptions[0], BACKUP_TX_OPTIONS)
    assert.equal(queries.length, BACKUP_TABLES.length)
    for (const query of queries) {
      const spec = BACKUP_TABLES.find((item) => item.delegate === query.delegate)
      assert.ok(spec)
      assert.deepEqual(query.where, spec.scope === 'id' ? { id: TENANT_A } : { tenantId: TENANT_A })
    }
  })

  it('encrypts gzip json and refuses the wrong key', () => {
    const gzipped = gzipSync(Buffer.from('{"tenantId":"only-inside"}', 'utf8'))
    const ciphertext = encryptBackupPayload(gzipped, KEY)
    assert.equal(ciphertext.subarray(0, 4).toString('utf8'), 'MKBC')
    assert.equal(ciphertext.includes('only-inside'), false)
    const opened = unpackSnapshot(ciphertext, KEY)
    assert.equal((opened as { tenantId?: string }).tenantId, 'only-inside')
    assert.throws(() => unpackSnapshot(ciphertext, OTHER_KEY), (err: unknown) => {
      return err instanceof Error && err.message === 'DECRYPT_FAILED'
    })
  })

  it('keeps personal data out of the manifest and the object key', async () => {
    const store = new MemoryStore()
    const logs: string[] = []
    await runTenantBackups({
      now: NOW,
      encryptionKey: KEY,
      store,
      log: (line) => logs.push(line),
      notify: async () => ({ sent: true }),
      listCandidates: async () => [{ id: TENANT_A, demoMu: false, lisansDurumu: 'AKTIF' }],
      exportTenant: (tenantId, now) => readTenantSnapshot(makeDb(), tenantId, now, FINGERPRINT)
    })
    const manifestRaw = store.objects.get(manifestObjectKey(TENANT_A, TODAY))!.toString('utf8')
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>
    assert.deepEqual(Object.keys(manifest).sort(), [...MANIFEST_KEYS].sort())
    const snapshotKey = snapshotObjectKey(TENANT_A, TODAY)
    const snapshotBody = store.objects.get(snapshotKey)!
    for (const secret of [PII_EMAIL, PII_PHONE, PII_HASH, PII_NAME]) {
      assert.equal(manifestRaw.includes(secret), false, secret)
      assert.equal(snapshotKey.includes(secret), false, secret)
      assert.equal(snapshotBody.includes(Buffer.from(secret)), false, secret)
      for (const line of logs) assert.equal(line.includes(secret), false, secret)
    }
    assert.equal(manifestRaw.includes('@'), false)
    assert.equal(snapshotKey.includes('@'), false)
    assert.match(snapshotKey, /^tenants\/[0-9a-f-]{36}\/daily\/\d{4}-\d{2}-\d{2}\/snapshot\.json\.gz\.enc$/)
    assert.throws(() => snapshotObjectKey(PII_EMAIL, TODAY))
    const snap = unpackSnapshot(snapshotBody, KEY)
    assert.equal(snap.tables.tenant[0]?.eposta, PII_EMAIL)
  })

  it('retains 15 Istanbul days and ignores other tenants and unknown keys', () => {
    assert.equal(istanbulCalendarDate(NOW), TODAY)
    assert.equal(istanbulCalendarDate(new Date('2026-10-05T20:59:00.000Z')), '2026-10-05')
    assert.equal(retentionKeepFrom(TODAY, 15), '2026-09-22')
    assert.equal(addCalendarDays(TODAY, -14), '2026-09-22')
    const oldA = snapshotObjectKey(TENANT_A, '2026-09-21')
    const oldManifest = manifestObjectKey(TENANT_A, '2026-09-21')
    const keep = snapshotObjectKey(TENANT_A, '2026-09-22')
    const other = snapshotObjectKey(TENANT_C, '2020-01-01')
    const junk = `tenants/${TENANT_A}/daily/2020-01-01/notes.txt`
    const doomed = selectRetentionDeletes([oldA, oldManifest, keep, other, junk, TODAY], TENANT_A, TODAY)
    assert.deepEqual(doomed.sort(), [oldA, oldManifest].sort())
  })

  it('does not retain when upload fails, and continues after a tenant error', async () => {
    const store = new MemoryStore()
    store.failPutIncluding = [TENANT_A]
    seed(store, snapshotObjectKey(TENANT_B, '2026-09-21'))
    seed(store, snapshotObjectKey(TENANT_C, '2020-01-01'))
    store.extraKeys = [snapshotObjectKey(TENANT_C, '2020-01-01'), `tenants/${TENANT_B}/daily/2020-01-01/notes.txt`]
    const logs: string[] = []
    let mailed = 0
    const result = await runTenantBackups({
      now: NOW,
      encryptionKey: KEY,
      store,
      log: (line) => logs.push(line),
      notify: async (failures) => {
        mailed += 1
        const mail = buildBackupFailureMail(failures)
        assert.equal(mail.text.includes(PII_EMAIL), false)
        assert.match(mail.text, new RegExp(TENANT_A))
        return { sent: true }
      },
      listCandidates: async () => [
        { id: TENANT_A, demoMu: false, lisansDurumu: 'AKTIF' },
        { id: TENANT_B, demoMu: false, lisansDurumu: 'AKTIF' }
      ],
      exportTenant: (tenantId, now) => readTenantSnapshot(makeDb(), tenantId, now, FINGERPRINT)
    })

    assert.deepEqual(result.failed.map((item) => item.tenantId), [TENANT_A])
    assert.deepEqual(result.ok, [TENANT_B])
    assert.equal(store.listPrefixes.includes(`tenants/${TENANT_A}/daily/`), false)
    assert.equal(store.deleted.includes(snapshotObjectKey(TENANT_C, '2020-01-01')), false)
    assert.equal(store.deleted.includes(snapshotObjectKey(TENANT_B, '2026-09-21')), true)
    assert.equal(store.deleted.some((key) => key.endsWith('notes.txt')), false)
    assert.equal(store.objects.has(snapshotObjectKey(TENANT_C, '2020-01-01')), true)
    assert.equal(store.objects.has(snapshotObjectKey(TENANT_B, TODAY)), true)
    assert.equal(mailed, 1)
    assert.equal(logs.some((line) => line.includes(PII_NAME)), false)
  })

  it('does not delete anything when listing fails after a successful upload', async () => {
    const store = new MemoryStore()
    store.failList = true
    seed(store, snapshotObjectKey(TENANT_A, '2020-01-01'))
    const result = await runTenantBackups({
      now: NOW,
      encryptionKey: KEY,
      store,
      log: () => undefined,
      notify: async () => {
        throw new Error('smtp down')
      },
      listCandidates: async () => [{ id: TENANT_A, demoMu: false, lisansDurumu: 'AKTIF' }],
      exportTenant: (tenantId, now) => readTenantSnapshot(makeDb(), tenantId, now, FINGERPRINT)
    })
    assert.equal(result.failed[0]?.code, 'RETENTION_LIST_FAILED')
    assert.equal(store.deleted.length, 0)
    assert.equal(store.objects.has(snapshotObjectKey(TENANT_A, '2020-01-01')), true)
  })

  it('keeps backup failure visible when notification throws', async () => {
    const logs: string[] = []
    const result = await runTenantBackups({
      now: NOW,
      encryptionKey: KEY,
      store: new MemoryStore(),
      log: (line) => logs.push(line),
      notify: async () => {
        throw new Error(PII_EMAIL)
      },
      listCandidates: async () => [{ id: TENANT_A, demoMu: false, lisansDurumu: 'AKTIF' }],
      exportTenant: async () => {
        throw new Error('database exploded with ' + PII_EMAIL)
      }
    })
    assert.equal(result.failed[0]?.code, 'BACKUP_FAILED')
    assert.equal(logs.some((line) => line.includes('mail-failed')), true)
    assert.equal(logs.some((line) => line.includes(PII_EMAIL)), false)
    const mailed = await notifyBackupFailures([{ tenantId: TENANT_A, stage: 'export', code: 'BACKUP_FAILED' }], async () => {
      throw new Error('mail')
    })
    assert.equal(mailed.sent, false)
    assert.equal(mailed.code, 'MAIL_FAILED')
  })

  it('rejects a reused application secret without echoing it', () => {
    const secret = 'z'.repeat(40)
    assert.throws(
      () =>
        loadBackupEnv({
          R2_ACCOUNT_ID: 'abc123',
          R2_ACCESS_KEY_ID: 'access',
          R2_SECRET_ACCESS_KEY: 'secret-value',
          R2_BUCKET: 'woontegra-disaster-backups',
          R2_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com',
          BACKUP_ENCRYPTION_KEY: secret,
          JWT_SECRET: secret,
          DATABASE_URL: 'postgresql://localhost/test'
        }),
      (err: unknown) => {
        assert.ok(err instanceof BackupConfigError)
        assert.equal(err.code, 'BACKUP_KEY_REUSED')
        assert.equal(err.message.includes(secret), false)
        return true
      }
    )
  })

  it('has no database write calls in the backup path', () => {
    const files = fs
      .readdirSync(here)
      .filter((name) => name.endsWith('.ts') && name !== 'backup.test.ts')
      .map((name) => path.join(here, name))
    files.push(path.resolve(here, '../../scripts/backup-tenants.ts'))
    const writeCall = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      assert.equal(/\$executeRaw/.test(source), false, path.basename(file))
      assert.equal(/\bINSERT\s+INTO\b/i.test(source), false, path.basename(file))
      assert.equal(/\bDELETE\s+FROM\b/i.test(source), false, path.basename(file))
      assert.equal(/\bUPDATE\s+[a-z_]+\s+SET\b/i.test(source), false, path.basename(file))
      for (const line of source.split('\n')) {
        if (!writeCall.test(line)) continue
        const cryptoCall =
          line.includes('createCipheriv') ||
          line.includes('createDecipheriv') ||
          line.includes('createHash') ||
          line.includes('cipher.update') ||
          line.includes('decipher.update') ||
          line.includes('hash.update') ||
          line.includes('.update(ciphertext)') ||
          line.includes(".update(secret, 'utf8')")
        assert.equal(cryptoCall, true, `${path.basename(file)} ${line.trim()}`)
      }
    }
    const crypto = fs.readFileSync(path.join(here, 'backupCrypto.ts'), 'utf8')
    assert.equal(crypto.includes('JWT_SECRET'), false)
    assert.equal(crypto.includes('WHATSAPP_TOKEN_ENCRYPTION_KEY'), false)
    const fingerprint = computeSchemaFingerprint(path.resolve(here, '../../prisma/migrations'))
    assert.match(fingerprint, /^[0-9a-f]{64}$/)
  })
})
