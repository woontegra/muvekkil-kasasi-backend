import path from 'node:path'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { loadBackupEnv } from '../backupEnv.js'
import { BackupConfigError, BackupTenantError } from '../backupErrors.js'
import { readTenantSnapshot } from '../backupExport.js'
import { prismaBackupDatabase } from '../backupPrisma.js'
import { createR2BackupStore } from '../backupR2.js'
import { computeSchemaFingerprint } from '../backupSchema.js'
import { BACKUP_TABLES } from '../backupTables.js'
import { applyRestoreSnapshot, type RestoreWriter } from './restoreApply.js'
import { coerceRestoreRow } from './restoreCoerce.js'
import { runTenantRestore, type TenantRestoreResult } from './restoreService.js'

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  maxWait: 15_000,
  timeout: 120_000
} as const

type ModelApi = {
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
  create(args: { data: Record<string, unknown> }): Promise<unknown>
  findMany(args: { where: Record<string, unknown>; select: { id: true } }): Promise<Array<{ id: string }>>
}

type Tx = Prisma.TransactionClient

function modelApi(tx: Tx, delegate: string): ModelApi {
  const spec = BACKUP_TABLES.find((item) => item.delegate === delegate)
  if (!spec) throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
  const api = (tx as unknown as Record<string, ModelApi | undefined>)[delegate]
  if (!api?.deleteMany || !api.updateMany || !api.create || !api.findMany) {
    throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
  }
  return api
}

function assertTenantScope(tenantId: string, id: string): void {
  if (!tenantId || !id) throw new BackupTenantError('RESTORE_FOREIGN_TENANT', 'restore')
}

function writerFor(tx: Tx): RestoreWriter {
  return {
    async lockTenant(tenantId) {
      assertTenantScope(tenantId, tenantId)
      const rows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "tenant" WHERE id = ${tenantId} FOR UPDATE`
      )
      if (!Array.isArray(rows) || rows.length !== 1) {
        throw new BackupTenantError('RESTORE_TENANT_MISSING', 'restore')
      }
    },
    async listIds(delegate, tenantId) {
      assertTenantScope(tenantId, tenantId)
      const spec = BACKUP_TABLES.find((item) => item.delegate === delegate)
      if (!spec || spec.scope !== 'tenantId') throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
      const rows = await modelApi(tx, delegate).findMany({ where: { tenantId }, select: { id: true } })
      return rows.map((row) => row.id)
    },
    async deleteSlice(delegate, tenantId) {
      assertTenantScope(tenantId, tenantId)
      const spec = BACKUP_TABLES.find((item) => item.delegate === delegate)
      if (!spec || spec.scope !== 'tenantId' || spec.model === 'User') {
        throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
      }
      await modelApi(tx, delegate).deleteMany({ where: { tenantId } })
    },
    async guardUserDeletes(tenantId, userIds) {
      assertTenantScope(tenantId, tenantId)
      if (userIds.length === 0) return
      const linked = await tx.superAdmin.count({ where: { linkedUserId: { in: [...userIds] } } })
      if (linked > 0) throw new BackupTenantError('RESTORE_ADMIN_LINK', 'restore')
    },
    async deleteOwnedUser(tenantId, id) {
      assertTenantScope(tenantId, id)
      const result = await modelApi(tx, 'user').deleteMany({ where: { id, tenantId } })
      if (result.count !== 1) throw new BackupTenantError('RESTORE_ROW_MISSING', 'restore')
    },
    async updateOwned(delegate, tenantId, id, data) {
      assertTenantScope(tenantId, id)
      if (delegate !== 'tenant' && delegate !== 'user') {
        throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
      }
      if (delegate === 'tenant' && id !== tenantId) throw new BackupTenantError('RESTORE_FOREIGN_TENANT', 'restore')
      const spec = BACKUP_TABLES.find((item) => item.delegate === delegate)
      if (!spec) throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
      const result = await modelApi(tx, delegate).updateMany({
        where: delegate === 'tenant' ? { id: tenantId } : { id, tenantId },
        data: coerceRestoreRow(spec.model, data, 'update')
      })
      if (result.count !== 1) throw new BackupTenantError('RESTORE_ROW_MISSING', 'restore')
    },
    async insertOwned(delegate, tenantId, data) {
      assertTenantScope(tenantId, tenantId)
      const spec = BACKUP_TABLES.find((item) => item.delegate === delegate)
      if (!spec || spec.scope !== 'tenantId') throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
      const coerced = coerceRestoreRow(spec.model, data, 'create')
      if (String(coerced.tenantId ?? '').toLowerCase() !== tenantId) {
        throw new BackupTenantError('RESTORE_FOREIGN_TENANT', 'restore')
      }
      coerced.tenantId = tenantId
      await modelApi(tx, delegate).create({ data: coerced })
    }
  }
}

function logRestore(line: string): void {
  console.info(line)
}

export async function restoreTenantBackup(
  prismaClient: PrismaClient,
  input: { tenantId: string; calendarDate: string; confirmBuroAdi: string }
): Promise<TenantRestoreResult> {
  const started = Date.now()
  const tenantId = input.tenantId.toLowerCase()
  try {
    const cfg = loadBackupEnv(process.env)
    const schemaFingerprint = computeSchemaFingerprint(path.join(process.cwd(), 'prisma', 'migrations'))
    const store = createR2BackupStore(cfg)
    const result = await runTenantRestore(
      {
        now: new Date(),
        encryptionKey: cfg.encryptionKey,
        schemaFingerprint,
        store,
        readTenant: (id) =>
          prismaClient.tenant.findUnique({
            where: { id },
            select: { id: true, buroAdi: true, demoMu: true, lisansDurumu: true }
          }),
        exportTenant: (id, now) =>
          readTenantSnapshot(prismaBackupDatabase(prismaClient), id, now, schemaFingerprint),
        apply: (snapshot) =>
          prismaClient.$transaction(async (tx) => {
            await applyRestoreSnapshot(writerFor(tx), snapshot, tenantId)
          }, TX_OPTIONS)
      },
      input
    )
    logRestore(`[restore] ok tenant=${result.tenantId} date=${result.calendarDate} ms=${Date.now() - started}`)
    return result
  } catch (err) {
    const code = err instanceof BackupTenantError || err instanceof BackupConfigError ? err.code : 'RESTORE_FAILED'
    const stage = err instanceof BackupTenantError ? err.stage : 'restore'
    logRestore(`[restore] fail tenant=${tenantId} stage=${stage} code=${code}`)
    if (err instanceof BackupTenantError || err instanceof BackupConfigError) throw err
    throw new BackupTenantError('RESTORE_FAILED', 'restore')
  }
}

export function restoreTenantBackupFromRequest(input: {
  tenantId: string
  calendarDate: string
  confirmBuroAdi: string
}): Promise<TenantRestoreResult> {
  return restoreTenantBackup(prisma, input)
}
