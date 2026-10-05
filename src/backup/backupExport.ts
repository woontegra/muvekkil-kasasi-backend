import { Prisma } from '@prisma/client'
import { istanbulCalendarDate } from './backupCalendar.js'
import { BackupTenantError } from './backupErrors.js'
import { serializeBackupRow } from './backupSerialize.js'
import { BACKUP_TABLES, type BackupTableSpec } from './backupTables.js'

export const BACKUP_TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  maxWait: 15_000,
  timeout: 120_000
} as const

type QueryRaw = (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>

type FindManyDelegate = {
  findMany: (args: { where: Record<string, unknown> }) => Promise<Record<string, unknown>[]>
}

export type BackupTx = {
  $queryRaw: QueryRaw
  delegate: (name: string) => FindManyDelegate
}

export type BackupDatabase = {
  $transaction: <T>(fn: (tx: BackupTx) => Promise<T>, options: typeof BACKUP_TX_OPTIONS) => Promise<T>
}

export type TenantSnapshotPayload = {
  format: 'mk-tenant-backup'
  formatVersion: 1
  schemaFingerprint: string
  tenantId: string
  capturedAt: string
  timezone: 'Europe/Istanbul'
  calendarDate: string
  isolation: 'RepeatableRead'
  tables: Record<string, Record<string, unknown>[]>
}

export type TenantSnapshotResult =
  | { kind: 'skip-demo' }
  | { kind: 'missing' }
  | { kind: 'ok'; payload: TenantSnapshotPayload }

function whereFor(spec: BackupTableSpec, tenantId: string): Record<string, unknown> {
  if (spec.scope === 'id') return { id: tenantId }
  return { tenantId }
}

function assertOwned(spec: BackupTableSpec, tenantId: string, row: Record<string, unknown>): void {
  if (spec.scope === 'id') {
    if (row.id !== tenantId) throw new BackupTenantError('FOREIGN_TENANT_ROW', 'export')
    return
  }
  if (row.tenantId !== tenantId) throw new BackupTenantError('FOREIGN_TENANT_ROW', 'export')
}

function isDemoTenant(row: Record<string, unknown>): boolean {
  return row.demoMu === true || row.lisansDurumu === 'DEMO'
}

export async function readTenantSnapshot(
  db: BackupDatabase,
  tenantId: string,
  now: Date,
  schemaFingerprint: string
): Promise<TenantSnapshotResult> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('transaction_read_only', 'on', true)`

    const tables: Record<string, Record<string, unknown>[]> = {}
    let tenantRow: Record<string, unknown> | null = null

    for (const spec of BACKUP_TABLES) {
      if (spec.delegate !== 'tenant' && tenantRow && isDemoTenant(tenantRow)) {
        return { kind: 'skip-demo' }
      }
      const rows = await tx.delegate(spec.delegate).findMany({ where: whereFor(spec, tenantId) })
      if (!Array.isArray(rows)) throw new BackupTenantError('EXPORT_READ_FAILED', 'export')
      const serialized = rows.map((row) => {
        assertOwned(spec, tenantId, row)
        return serializeBackupRow(row)
      })
      if (spec.delegate === 'tenant') {
        if (serialized.length === 0) return { kind: 'missing' }
        if (serialized.length !== 1) throw new BackupTenantError('TENANT_ROW_COUNT', 'export')
        tenantRow = serialized[0]!
        if (isDemoTenant(tenantRow)) return { kind: 'skip-demo' }
      }
      tables[spec.delegate] = serialized
    }

    return {
      kind: 'ok',
      payload: {
        format: 'mk-tenant-backup',
        formatVersion: 1,
        schemaFingerprint,
        tenantId,
        capturedAt: now.toISOString(),
        timezone: 'Europe/Istanbul',
        calendarDate: istanbulCalendarDate(now),
        isolation: 'RepeatableRead',
        tables
      }
    }
  }, BACKUP_TX_OPTIONS)
}
