import { BACKUP_OBJECT_KEY_RE, assertTenantUuid, manifestObjectKey, snapshotObjectKey } from '../backupObjectKey.js'
import { BackupTenantError } from '../backupErrors.js'

const STAMP_RE = /^\d{8}T\d{6}\d{3}Z$/

export function assertCalendarDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BackupTenantError('DATE_INVALID', 'restore')
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new BackupTenantError('DATE_INVALID', 'restore')
  }
}

export function assertDailyBackupKey(tenantId: string, key: string): void {
  assertTenantUuid(tenantId)
  const match = BACKUP_OBJECT_KEY_RE.exec(key)
  if (!match || match[1]!.toLowerCase() !== tenantId.toLowerCase()) {
    throw new BackupTenantError('RESTORE_OBJECT_KEY', 'restore')
  }
  const expectedPrefix = `tenants/${match[1]}/daily/`
  if (!key.startsWith(expectedPrefix) || key.includes('..') || key.includes('@')) {
    throw new BackupTenantError('RESTORE_OBJECT_KEY', 'restore')
  }
}

export function dailyKeysForTenant(tenantId: string, calendarDate: string): { snapshotKey: string; manifestKey: string } {
  assertCalendarDate(calendarDate)
  const snapshotKey = snapshotObjectKey(tenantId, calendarDate)
  const manifestKey = manifestObjectKey(tenantId, calendarDate)
  assertDailyBackupKey(tenantId, snapshotKey)
  assertDailyBackupKey(tenantId, manifestKey)
  return { snapshotKey, manifestKey }
}

export function preRestoreStamp(now: Date): string {
  const pad = (value: number, width: number) => String(value).padStart(width, '0')
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}T${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}${pad(now.getUTCMilliseconds(), 3)}Z`
}

export function preRestoreObjectKeys(tenantId: string, stamp: string): { snapshotKey: string; manifestKey: string } {
  assertTenantUuid(tenantId)
  if (!STAMP_RE.test(stamp)) throw new BackupTenantError('RESTORE_SAFETY_KEY', 'safety')
  const prefix = `tenants/${tenantId.toLowerCase()}/pre-restore/${stamp}/`
  return {
    snapshotKey: `${prefix}snapshot.json.gz.enc`,
    manifestKey: `${prefix}manifest.json`
  }
}
