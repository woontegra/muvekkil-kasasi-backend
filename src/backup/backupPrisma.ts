import type { PrismaClient } from '@prisma/client'
import { BackupTenantError } from './backupErrors.js'
import type { BackupDatabase, BackupTx } from './backupExport.js'

type RawTx = {
  $queryRaw: BackupTx['$queryRaw']
} & Record<string, { findMany?: (args: { where: Record<string, unknown> }) => Promise<Record<string, unknown>[]> } | undefined>

export function prismaBackupDatabase(prisma: PrismaClient): BackupDatabase {
  return {
    $transaction(fn, options) {
      return prisma.$transaction((raw) => fn(adaptTx(raw as unknown as RawTx)), options)
    }
  }
}

function adaptTx(raw: RawTx): BackupTx {
  return {
    $queryRaw: (query, ...values) => raw.$queryRaw(query, ...values),
    delegate(name: string) {
      const model = raw[name]
      if (!model?.findMany) throw new BackupTenantError('DELEGATE_MISSING', 'export')
      return { findMany: (args) => model.findMany!(args) }
    }
  }
}
