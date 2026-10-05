import { BackupTenantError } from './backupErrors.js'

export const TENANT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

export const BACKUP_OBJECT_KEY_RE =
  /^tenants\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/daily\/(\d{4}-\d{2}-\d{2})\/(snapshot\.json\.gz\.enc|manifest\.json)$/i

export function assertTenantUuid(tenantId: string): void {
  if (!TENANT_UUID_RE.test(tenantId)) {
    throw new BackupTenantError('TENANT_ID_INVALID', 'key')
  }
}

export function dailyPrefix(tenantId: string): string {
  assertTenantUuid(tenantId)
  return `tenants/${tenantId}/daily/`
}

export function snapshotObjectKey(tenantId: string, calendarDate: string): string {
  assertTenantUuid(tenantId)
  if (!YMD_RE.test(calendarDate)) throw new BackupTenantError('DATE_INVALID', 'key')
  return `tenants/${tenantId}/daily/${calendarDate}/snapshot.json.gz.enc`
}

export function manifestObjectKey(tenantId: string, calendarDate: string): string {
  assertTenantUuid(tenantId)
  if (!YMD_RE.test(calendarDate)) throw new BackupTenantError('DATE_INVALID', 'key')
  return `tenants/${tenantId}/daily/${calendarDate}/manifest.json`
}
