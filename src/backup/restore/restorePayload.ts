import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { decryptBackupPayload } from '../backupCrypto.js'
import { BackupTenantError } from '../backupErrors.js'
import type { TenantSnapshotPayload } from '../backupExport.js'
import { BACKUP_TABLES } from '../backupTables.js'
import { restoreForeignKeys } from './restoreOrder.js'

const DELEGATES = BACKUP_TABLES.map((spec) => spec.delegate)

export function openRestoreSnapshot(ciphertext: Buffer, encryptionKey: string): TenantSnapshotPayload {
  let gzipped: Buffer
  try {
    gzipped = decryptBackupPayload(ciphertext, encryptionKey)
  } catch (err) {
    if (err instanceof BackupTenantError && err.code === 'DECRYPT_FAILED') throw err
    throw new BackupTenantError('DECRYPT_FAILED', 'decrypt')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(gunzipSync(gzipped).toString('utf8'))
  } catch {
    throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'decrypt')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'decrypt')
  }
  return parsed as TenantSnapshotPayload
}

export function assertRestoreSnapshot(
  snapshot: TenantSnapshotPayload,
  tenantId: string,
  schemaFingerprint: string
): void {
  if (snapshot.format !== 'mk-tenant-backup' || snapshot.formatVersion !== 1) {
    throw new BackupTenantError('RESTORE_SCHEMA_MISMATCH', 'restore')
  }
  if (snapshot.schemaFingerprint !== schemaFingerprint) {
    throw new BackupTenantError('RESTORE_SCHEMA_MISMATCH', 'restore')
  }
  if (snapshot.tenantId.toLowerCase() !== tenantId.toLowerCase()) {
    throw new BackupTenantError('RESTORE_TENANT_MISMATCH', 'restore')
  }
  const tableNames = Object.keys(snapshot.tables ?? {})
  if (tableNames.length !== DELEGATES.length || DELEGATES.some((name) => !tableNames.includes(name))) {
    throw new BackupTenantError('RESTORE_SCHEMA_MISMATCH', 'restore')
  }
  const ids = new Map<string, Set<string>>()
  for (const spec of BACKUP_TABLES) {
    const rows = snapshot.tables[spec.delegate]
    if (!Array.isArray(rows)) throw new BackupTenantError('RESTORE_SCHEMA_MISMATCH', 'restore')
    const seen = new Set<string>()
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'restore')
      }
      const id = row.id
      if (typeof id !== 'string' || seen.has(id)) throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'restore')
      seen.add(id)
      if (spec.scope === 'id') {
        if (id.toLowerCase() !== tenantId.toLowerCase()) throw new BackupTenantError('RESTORE_TENANT_MISMATCH', 'restore')
      } else if (String(row.tenantId ?? '').toLowerCase() !== tenantId.toLowerCase()) {
        throw new BackupTenantError('RESTORE_FOREIGN_TENANT', 'restore')
      }
    }
    ids.set(spec.model, seen)
  }
  for (const key of restoreForeignKeys()) {
    const spec = BACKUP_TABLES.find((item) => item.model === key.model)
    if (!spec) throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
    const parentIds = ids.get(key.parent)
    if (!parentIds) throw new BackupTenantError('RESTORE_SCHEMA_MISMATCH', 'restore')
    for (const row of snapshot.tables[spec.delegate] ?? []) {
      const value = row[key.field]
      if (value == null) continue
      if (typeof value !== 'string' || !parentIds.has(value)) {
        throw new BackupTenantError('RESTORE_FOREIGN_REFERENCE', 'restore')
      }
    }
  }
}

export function assertRestoreManifest(
  body: Buffer,
  tenantId: string,
  calendarDate: string,
  ciphertext: Buffer,
  schemaFingerprint: string
): void {
  const text = body.toString('utf8')
  if (text.includes('@')) throw new BackupTenantError('MANIFEST_PII', 'restore')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupTenantError('MANIFEST_INVALID', 'restore')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BackupTenantError('MANIFEST_INVALID', 'restore')
  }
  const manifest = parsed as Record<string, unknown>
  const sha256 = createHash('sha256').update(ciphertext).digest('hex')
  if (
    manifest.format !== 'mk-tenant-backup-manifest' ||
    manifest.formatVersion !== 1 ||
    String(manifest.tenantId).toLowerCase() !== tenantId.toLowerCase() ||
    manifest.calendarDate !== calendarDate ||
    manifest.schemaFingerprint !== schemaFingerprint ||
    manifest.snapshotSha256 !== sha256
  ) {
    throw new BackupTenantError('RESTORE_MANIFEST_MISMATCH', 'restore')
  }
}
