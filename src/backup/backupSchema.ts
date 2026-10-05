import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BackupConfigError } from './backupErrors.js'

export function computeSchemaFingerprint(migrationsDir: string): string {
  if (!fs.existsSync(migrationsDir)) {
    throw new BackupConfigError('SCHEMA_FINGERPRINT')
  }
  const hash = createHash('sha256')
  const names = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  if (names.length === 0) {
    throw new BackupConfigError('SCHEMA_FINGERPRINT')
  }
  for (const name of names) {
    hash.update(name)
    hash.update('\0')
    const sqlPath = path.join(migrationsDir, name, 'migration.sql')
    if (fs.existsSync(sqlPath)) {
      hash.update(fs.readFileSync(sqlPath))
    }
    hash.update('\0')
  }
  return hash.digest('hex')
}
