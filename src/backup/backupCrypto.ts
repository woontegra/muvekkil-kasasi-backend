import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { BackupTenantError } from './backupErrors.js'

const ALGO = 'aes-256-gcm'
const MAGIC = Buffer.from('MKBC')
const VERSION = 1
const IV_LEN = 12
const TAG_LEN = 16
const HEADER_LEN = MAGIC.length + 1 + IV_LEN + TAG_LEN

export function deriveBackupKey(secret: string): Buffer {
  if (secret.length < 32) {
    throw new BackupTenantError('BACKUP_KEY_TOO_SHORT', 'encrypt')
  }
  return createHash('sha256').update(secret, 'utf8').digest()
}

export function encryptBackupPayload(plaintext: Buffer, secret: string): Buffer {
  const key = deriveBackupKey(secret)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), iv, tag, enc])
}

export function decryptBackupPayload(payload: Buffer, secret: string): Buffer {
  if (payload.length < HEADER_LEN || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupTenantError('DECRYPT_FAILED', 'decrypt')
  }
  if (payload[MAGIC.length] !== VERSION) {
    throw new BackupTenantError('DECRYPT_FAILED', 'decrypt')
  }
  const ivStart = MAGIC.length + 1
  const tagStart = ivStart + IV_LEN
  const dataStart = tagStart + TAG_LEN
  const iv = payload.subarray(ivStart, tagStart)
  const tag = payload.subarray(tagStart, dataStart)
  const data = payload.subarray(dataStart)
  try {
    const decipher = createDecipheriv(ALGO, deriveBackupKey(secret), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()])
  } catch {
    throw new BackupTenantError('DECRYPT_FAILED', 'decrypt')
  }
}

export function assertSnapshotCiphertext(body: Buffer): void {
  if (body.length < MAGIC.length || !body.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupTenantError('PLAINTEXT_UPLOAD_BLOCKED', 'upload')
  }
}
