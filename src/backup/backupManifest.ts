import { BackupTenantError } from './backupErrors.js'

export const MANIFEST_KEYS = [
  'format',
  'formatVersion',
  'tenantId',
  'calendarDate',
  'capturedAt',
  'timezone',
  'schemaFingerprint',
  'isolation',
  'rowCounts',
  'snapshotSha256',
  'snapshotBytes',
  'encryption'
] as const

export type BackupManifest = {
  format: 'mk-tenant-backup-manifest'
  formatVersion: 1
  tenantId: string
  calendarDate: string
  capturedAt: string
  timezone: 'Europe/Istanbul'
  schemaFingerprint: string
  isolation: 'RepeatableRead'
  rowCounts: Record<string, number>
  snapshotSha256: string
  snapshotBytes: number
  encryption: 'AES-256-GCM'
}

export function buildManifest(input: {
  tenantId: string
  calendarDate: string
  capturedAt: string
  schemaFingerprint: string
  rowCounts: Record<string, number>
  snapshotSha256: string
  snapshotBytes: number
}): BackupManifest {
  return {
    format: 'mk-tenant-backup-manifest',
    formatVersion: 1,
    tenantId: input.tenantId,
    calendarDate: input.calendarDate,
    capturedAt: input.capturedAt,
    timezone: 'Europe/Istanbul',
    schemaFingerprint: input.schemaFingerprint,
    isolation: 'RepeatableRead',
    rowCounts: input.rowCounts,
    snapshotSha256: input.snapshotSha256,
    snapshotBytes: input.snapshotBytes,
    encryption: 'AES-256-GCM'
  }
}

export function assertManifestSafe(body: Buffer): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    throw new BackupTenantError('MANIFEST_INVALID', 'upload')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BackupTenantError('MANIFEST_INVALID', 'upload')
  }
  const keys = Object.keys(parsed)
  if (keys.length !== MANIFEST_KEYS.length || MANIFEST_KEYS.some((key) => !keys.includes(key))) {
    throw new BackupTenantError('MANIFEST_FIELD', 'upload')
  }
  if (body.toString('utf8').includes('@')) {
    throw new BackupTenantError('MANIFEST_PII', 'upload')
  }
}
