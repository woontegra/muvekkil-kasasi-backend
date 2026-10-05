import { BackupConfigError } from './backupErrors.js'

const REQUIRED = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_ENDPOINT',
  'BACKUP_ENCRYPTION_KEY',
  'DATABASE_URL'
] as const

export const EXPECTED_R2_BUCKET = 'woontegra-disaster-backups'

export type BackupEnvConfig = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  endpoint: string
  encryptionKey: string
}

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name]
  return typeof value === 'string' ? value.trim() : ''
}

export function loadBackupEnv(source: NodeJS.ProcessEnv): BackupEnvConfig {
  const missing = REQUIRED.filter((name) => required(source, name).length === 0)
  if (missing.length > 0) {
    throw new BackupConfigError('BACKUP_ENV_MISSING', [...missing])
  }

  const bucket = required(source, 'R2_BUCKET')
  if (bucket !== EXPECTED_R2_BUCKET) {
    throw new BackupConfigError('R2_BUCKET_UNEXPECTED')
  }

  const encryptionKey = required(source, 'BACKUP_ENCRYPTION_KEY')
  if (encryptionKey.length < 32) {
    throw new BackupConfigError('BACKUP_KEY_TOO_SHORT')
  }
  const jwt = required(source, 'JWT_SECRET')
  const whatsAppKey = required(source, 'WHATSAPP_TOKEN_ENCRYPTION_KEY')
  if ((jwt && encryptionKey === jwt) || (whatsAppKey && encryptionKey === whatsAppKey)) {
    throw new BackupConfigError('BACKUP_KEY_REUSED')
  }

  const endpointRaw = required(source, 'R2_ENDPOINT')
  let endpoint: URL
  try {
    endpoint = new URL(endpointRaw)
  } catch {
    throw new BackupConfigError('R2_ENDPOINT_INVALID')
  }
  if (endpoint.protocol !== 'https:') {
    throw new BackupConfigError('R2_ENDPOINT_INVALID')
  }
  const accountId = required(source, 'R2_ACCOUNT_ID')
  if (!endpoint.hostname.includes(accountId)) {
    throw new BackupConfigError('R2_ENDPOINT_ACCOUNT_MISMATCH')
  }

  return {
    accountId,
    accessKeyId: required(source, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: required(source, 'R2_SECRET_ACCESS_KEY'),
    bucket,
    endpoint: endpoint.toString().replace(/\/$/, ''),
    encryptionKey
  }
}

const R2_LIST_REQUIRED = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_ENDPOINT'
] as const

/** Read-only catalog. Does not read or require the backup encryption key. */
export function loadBackupListEnv(source: NodeJS.ProcessEnv): Omit<BackupEnvConfig, 'encryptionKey'> {
  const missing = R2_LIST_REQUIRED.filter((name) => required(source, name).length === 0)
  if (missing.length > 0) {
    throw new BackupConfigError('BACKUP_ENV_MISSING', [...missing])
  }
  const bucket = required(source, 'R2_BUCKET')
  if (bucket !== EXPECTED_R2_BUCKET) {
    throw new BackupConfigError('R2_BUCKET_UNEXPECTED')
  }
  const endpointRaw = required(source, 'R2_ENDPOINT')
  let endpoint: URL
  try {
    endpoint = new URL(endpointRaw)
  } catch {
    throw new BackupConfigError('R2_ENDPOINT_INVALID')
  }
  if (endpoint.protocol !== 'https:') {
    throw new BackupConfigError('R2_ENDPOINT_INVALID')
  }
  const accountId = required(source, 'R2_ACCOUNT_ID')
  if (!endpoint.hostname.includes(accountId)) {
    throw new BackupConfigError('R2_ENDPOINT_ACCOUNT_MISMATCH')
  }
  return {
    accountId,
    accessKeyId: required(source, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: required(source, 'R2_SECRET_ACCESS_KEY'),
    bucket,
    endpoint: endpoint.toString().replace(/\/$/, '')
  }
}
