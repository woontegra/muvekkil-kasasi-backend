import 'dotenv/config'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { loadBackupEnv } from '../src/backup/backupEnv.js'
import { BackupConfigError } from '../src/backup/backupErrors.js'
import { readTenantSnapshot } from '../src/backup/backupExport.js'
import { notifyBackupFailures } from '../src/backup/backupNotify.js'
import { prismaBackupDatabase } from '../src/backup/backupPrisma.js'
import { createR2BackupStore } from '../src/backup/backupR2.js'
import { runTenantBackups } from '../src/backup/backupRun.js'
import { computeSchemaFingerprint } from '../src/backup/backupSchema.js'

async function main(): Promise<number> {
  const cfg = loadBackupEnv(process.env)
  const schemaFingerprint = computeSchemaFingerprint(path.join(process.cwd(), 'prisma', 'migrations'))
  const prisma = new PrismaClient({ log: [] })
  try {
    const result = await runTenantBackups({
      encryptionKey: cfg.encryptionKey,
      store: createR2BackupStore(cfg),
      log: (line) => console.info(line),
      listCandidates: () =>
        prisma.tenant.findMany({
          select: { id: true, demoMu: true, lisansDurumu: true }
        }),
      exportTenant: (tenantId, now) =>
        readTenantSnapshot(prismaBackupDatabase(prisma), tenantId, now, schemaFingerprint),
      notify: (failures) => notifyBackupFailures(failures)
    })
    return result.failed.length > 0 ? 1 : 0
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    if (err instanceof BackupConfigError) {
      const missing = err.missing?.length ? ` missing=${err.missing.join(',')}` : ''
      console.error(`[backup] fatal code=${err.code}${missing}`)
    } else {
      console.error('[backup] fatal code=BACKUP_FAILED')
    }
    process.exitCode = 1
  })
