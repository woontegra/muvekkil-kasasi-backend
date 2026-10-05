import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { decryptBackupPayload, encryptBackupPayload } from './backupCrypto.js'
import { BackupTenantError } from './backupErrors.js'
import type { TenantSnapshotPayload } from './backupExport.js'
import { BACKUP_TABLES } from './backupTables.js'

export type PackedSnapshot = {
  ciphertext: Buffer
  sha256: string
  rowCounts: Record<string, number>
  rowTotal: number
}

export function packSnapshot(payload: TenantSnapshotPayload, encryptionKey: string): PackedSnapshot {
  const rowCounts: Record<string, number> = {}
  let rowTotal = 0
  for (const spec of BACKUP_TABLES) {
    const rows = payload.tables[spec.delegate]
    if (!Array.isArray(rows)) throw new BackupTenantError('TABLE_MISSING', 'pack')
    rowCounts[spec.delegate] = rows.length
    rowTotal += rows.length
  }
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const gzipped = gzipSync(json)
  const ciphertext = encryptBackupPayload(gzipped, encryptionKey)
  return {
    ciphertext,
    sha256: createHash('sha256').update(ciphertext).digest('hex'),
    rowCounts,
    rowTotal
  }
}

/** Testlerin şifreli zarfı açması için. Restore akışı değildir. */
export function unpackSnapshot(ciphertext: Buffer, encryptionKey: string): TenantSnapshotPayload {
  const gzipped = decryptBackupPayload(ciphertext, encryptionKey)
  const json = gunzipSync(gzipped).toString('utf8')
  return JSON.parse(json) as TenantSnapshotPayload
}
