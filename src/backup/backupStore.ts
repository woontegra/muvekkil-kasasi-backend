import { assertSnapshotCiphertext } from './backupCrypto.js'
import { BackupTenantError } from './backupErrors.js'
import { assertManifestSafe } from './backupManifest.js'

export type BackupObjectStore = {
  putObject: (key: string, body: Buffer, contentType: string) => Promise<void>
  listKeys: (prefix: string) => Promise<string[]>
  deleteKeys: (keys: string[]) => Promise<void>
}

export function assertObjectUpload(key: string, body: Buffer): void {
  if (key.endsWith('/snapshot.json.gz.enc')) {
    assertSnapshotCiphertext(body)
    return
  }
  if (key.endsWith('/manifest.json')) {
    assertManifestSafe(body)
    return
  }
  throw new BackupTenantError('OBJECT_KEY_REJECTED', 'upload')
}
