import { shouldBackupTenant } from '../backupTables.js'
import { BackupTenantError } from '../backupErrors.js'
import type { TenantSnapshotPayload, TenantSnapshotResult } from '../backupExport.js'
import { buildManifest } from '../backupManifest.js'
import { packSnapshot } from '../backupPack.js'
import { assertObjectUpload } from '../backupStore.js'
import { assertTenantUuid } from '../backupObjectKey.js'
import { dailyKeysForTenant, preRestoreObjectKeys, preRestoreStamp } from './restoreKeys.js'
import { assertRestoreManifest, assertRestoreSnapshot, openRestoreSnapshot } from './restorePayload.js'

export type RestoreTenantRecord = {
  id: string
  buroAdi: string
  demoMu: boolean
  lisansDurumu: string
}

export type RestoreObjectStore = {
  getObject(key: string): Promise<Buffer | null>
  putObject(key: string, body: Buffer, contentType: string): Promise<void>
}

export type TenantRestoreResult = {
  tenantId: string
  calendarDate: string
  restoredAt: string
  safetyStamp: string
}

export type TenantRestoreDeps = {
  now: Date
  encryptionKey: string
  schemaFingerprint: string
  store: RestoreObjectStore
  readTenant(tenantId: string): Promise<RestoreTenantRecord | null>
  exportTenant(tenantId: string, now: Date): Promise<TenantSnapshotResult>
  apply(snapshot: TenantSnapshotPayload): Promise<void>
}

async function readObject(store: RestoreObjectStore, key: string): Promise<Buffer> {
  let body: Buffer | null
  try {
    body = await store.getObject(key)
  } catch (err) {
    if (err instanceof BackupTenantError) throw err
    throw new BackupTenantError('RESTORE_OBJECT_READ_FAILED', 'restore')
  }
  if (!body) throw new BackupTenantError('RESTORE_OBJECT_MISSING', 'restore')
  return body
}

export async function runTenantRestore(
  deps: TenantRestoreDeps,
  input: { tenantId: string; calendarDate: string; confirmBuroAdi: string }
): Promise<TenantRestoreResult> {
  assertTenantUuid(input.tenantId)
  const tenantId = input.tenantId.toLowerCase()
  const tenant = await deps.readTenant(tenantId)
  if (!tenant || tenant.id.toLowerCase() !== tenantId) {
    throw new BackupTenantError('RESTORE_TENANT_MISSING', 'restore')
  }
  if (!shouldBackupTenant(tenant)) throw new BackupTenantError('RESTORE_TENANT_INELIGIBLE', 'restore')
  if (input.confirmBuroAdi.trim() !== tenant.buroAdi.trim()) {
    throw new BackupTenantError('RESTORE_CONFIRMATION_MISMATCH', 'restore')
  }

  const { snapshotKey, manifestKey } = dailyKeysForTenant(tenantId, input.calendarDate)
  const ciphertext = await readObject(deps.store, snapshotKey)
  const manifestBody = await readObject(deps.store, manifestKey)
  const snapshot = openRestoreSnapshot(ciphertext, deps.encryptionKey)
  assertRestoreSnapshot(snapshot, tenantId, deps.schemaFingerprint)
  assertRestoreManifest(manifestBody, tenantId, input.calendarDate, ciphertext, deps.schemaFingerprint)

  let exported: TenantSnapshotResult
  try {
    exported = await deps.exportTenant(tenantId, deps.now)
  } catch (err) {
    if (err instanceof BackupTenantError) throw err
    throw new BackupTenantError('RESTORE_SAFETY_BACKUP_FAILED', 'safety')
  }
  if (exported.kind !== 'ok' || exported.payload.tenantId.toLowerCase() !== tenantId) {
    throw new BackupTenantError('RESTORE_SAFETY_BACKUP_FAILED', 'safety')
  }

  const safetyStamp = preRestoreStamp(deps.now)
  const safetyKeys = preRestoreObjectKeys(tenantId, safetyStamp)
  const packed = packSnapshot(exported.payload, deps.encryptionKey)
  const manifest = buildManifest({
    tenantId,
    calendarDate: exported.payload.calendarDate,
    capturedAt: exported.payload.capturedAt,
    schemaFingerprint: exported.payload.schemaFingerprint,
    rowCounts: packed.rowCounts,
    snapshotSha256: packed.sha256,
    snapshotBytes: packed.ciphertext.length
  })
  const safetyManifest = Buffer.from(JSON.stringify(manifest), 'utf8')
  assertObjectUpload(safetyKeys.snapshotKey, packed.ciphertext)
  assertObjectUpload(safetyKeys.manifestKey, safetyManifest)
  try {
    await deps.store.putObject(safetyKeys.snapshotKey, packed.ciphertext, 'application/octet-stream')
    await deps.store.putObject(safetyKeys.manifestKey, safetyManifest, 'application/json')
  } catch (err) {
    if (err instanceof BackupTenantError) throw err
    throw new BackupTenantError('RESTORE_SAFETY_BACKUP_FAILED', 'safety')
  }

  try {
    await deps.apply(snapshot)
  } catch (err) {
    if (err instanceof BackupTenantError) throw err
    throw new BackupTenantError('RESTORE_FAILED', 'restore')
  }

  return {
    tenantId,
    calendarDate: input.calendarDate,
    restoredAt: deps.now.toISOString(),
    safetyStamp
  }
}
