import { BackupTenantError } from '../backupErrors.js'
import type { TenantSnapshotPayload } from '../backupExport.js'
import { assertRestoreSnapshot } from './restorePayload.js'
import { delegateForModel, orderRestoreRows, restoreDeleteOrder, restoreInsertOrder, selfReferenceField } from './restoreOrder.js'

export type RestoreWriter = {
  lockTenant(tenantId: string): Promise<void>
  listIds(delegate: string, tenantId: string): Promise<string[]>
  deleteSlice(delegate: string, tenantId: string): Promise<void>
  guardUserDeletes(tenantId: string, userIds: readonly string[]): Promise<void>
  deleteOwnedUser(tenantId: string, id: string): Promise<void>
  updateOwned(delegate: string, tenantId: string, id: string, data: Record<string, unknown>): Promise<void>
  insertOwned(delegate: string, tenantId: string, data: Record<string, unknown>): Promise<void>
}

function rowsOf(snapshot: TenantSnapshotPayload, delegate: string): Record<string, unknown>[] {
  const rows = snapshot.tables[delegate]
  if (!Array.isArray(rows)) throw new BackupTenantError('RESTORE_SCHEMA_MISMATCH', 'restore')
  return rows
}

export async function applyRestoreSnapshot(
  writer: RestoreWriter,
  snapshot: TenantSnapshotPayload,
  tenantId: string
): Promise<void> {
  assertRestoreSnapshot(snapshot, tenantId, snapshot.schemaFingerprint)
  const normalizedTenantId = tenantId.toLowerCase()
  await writer.lockTenant(normalizedTenantId)

  const userRows = rowsOf(snapshot, 'user')
  const snapshotUserIds = new Set(userRows.map((row) => String(row.id)))
  const liveUserIds = await writer.listIds('user', normalizedTenantId)
  const removeUserIds = liveUserIds.filter((id) => !snapshotUserIds.has(id))
  await writer.guardUserDeletes(normalizedTenantId, removeUserIds)

  for (const model of restoreDeleteOrder()) {
    await writer.deleteSlice(delegateForModel(model), normalizedTenantId)
  }

  const tenantRows = rowsOf(snapshot, 'tenant')
  if (tenantRows.length !== 1) throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'restore')
  await writer.updateOwned('tenant', normalizedTenantId, normalizedTenantId, tenantRows[0]!)

  for (const id of removeUserIds) {
    await writer.deleteOwnedUser(normalizedTenantId, id)
  }
  for (const row of userRows) {
    const id = String(row.id)
    if (liveUserIds.includes(id)) await writer.updateOwned('user', normalizedTenantId, id, row)
    else await writer.insertOwned('user', normalizedTenantId, row)
  }

  for (const model of restoreInsertOrder()) {
    if (model === 'Tenant' || model === 'User') continue
    const delegate = delegateForModel(model)
    const ordered = selfReferenceField(model) ? orderRestoreRows(model, rowsOf(snapshot, delegate)) : rowsOf(snapshot, delegate)
    for (const row of ordered) {
      await writer.insertOwned(delegate, normalizedTenantId, row)
    }
  }
}
