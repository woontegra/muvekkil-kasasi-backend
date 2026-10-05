import { shouldBackupTenant } from './backupTables.js'
import { istanbulCalendarDate } from './backupCalendar.js'
import { BackupTenantError } from './backupErrors.js'
import type { TenantSnapshotResult } from './backupExport.js'
import { buildManifest } from './backupManifest.js'
import { notifyBackupFailures, type BackupFailureNotice } from './backupNotify.js'
import { manifestObjectKey, snapshotObjectKey, dailyPrefix } from './backupObjectKey.js'
import { packSnapshot } from './backupPack.js'
import { selectRetentionDeletes } from './backupRetention.js'
import { assertObjectUpload, type BackupObjectStore } from './backupStore.js'

export type BackupCandidate = {
  id: string
  demoMu: boolean
  lisansDurumu: string
}

export type BackupRunResult = {
  calendarDate: string
  ok: string[]
  failed: BackupFailureNotice[]
  skippedDemo: string[]
  skippedMissing: string[]
}

export type BackupRunDeps = {
  now?: Date
  encryptionKey: string
  store: BackupObjectStore
  listCandidates: () => Promise<BackupCandidate[]>
  exportTenant: (tenantId: string, now: Date) => Promise<TenantSnapshotResult>
  notify?: (failures: BackupFailureNotice[]) => Promise<{ sent: boolean; code?: string }>
  log?: (line: string) => void
}

function toFailure(tenantId: string, err: unknown): BackupFailureNotice {
  if (err instanceof BackupTenantError) {
    return { tenantId, stage: err.stage, code: err.code }
  }
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    const code = (err as { code: string }).code
    if (/^P\d+$/.test(code)) return { tenantId, stage: 'export', code }
  }
  return { tenantId, stage: 'backup', code: 'BACKUP_FAILED' }
}

async function applyRetention(
  store: BackupObjectStore,
  tenantId: string,
  calendarDate: string
): Promise<number> {
  let keys: string[]
  try {
    keys = await store.listKeys(dailyPrefix(tenantId))
  } catch (err) {
    if (err instanceof BackupTenantError) throw err
    throw new BackupTenantError('RETENTION_LIST_FAILED', 'retention')
  }
  const doomed = selectRetentionDeletes(keys, tenantId, calendarDate)
  if (doomed.length === 0) return 0
  try {
    await store.deleteKeys(doomed)
  } catch (err) {
    if (err instanceof BackupTenantError) throw err
    throw new BackupTenantError('RETENTION_DELETE_FAILED', 'retention')
  }
  return doomed.length
}

export async function runTenantBackups(deps: BackupRunDeps): Promise<BackupRunResult> {
  const now = deps.now ?? new Date()
  const calendarDate = istanbulCalendarDate(now)
  const candidates = await deps.listCandidates()
  const ok: string[] = []
  const failed: BackupFailureNotice[] = []
  const skippedDemo: string[] = []
  const skippedMissing: string[] = []

  for (const candidate of candidates) {
    const started = Date.now()
    if (!shouldBackupTenant(candidate)) {
      skippedDemo.push(candidate.id)
      deps.log?.(`[backup] skip-demo tenant=${candidate.id}`)
      continue
    }
    try {
      const snapshot = await deps.exportTenant(candidate.id, now)
      if (snapshot.kind === 'skip-demo') {
        skippedDemo.push(candidate.id)
        deps.log?.(`[backup] skip-demo tenant=${candidate.id}`)
        continue
      }
      if (snapshot.kind === 'missing') {
        skippedMissing.push(candidate.id)
        deps.log?.(`[backup] skip-missing tenant=${candidate.id}`)
        continue
      }
      const packed = packSnapshot(snapshot.payload, deps.encryptionKey)
      const manifest = buildManifest({
        tenantId: candidate.id,
        calendarDate,
        capturedAt: snapshot.payload.capturedAt,
        schemaFingerprint: snapshot.payload.schemaFingerprint,
        rowCounts: packed.rowCounts,
        snapshotSha256: packed.sha256,
        snapshotBytes: packed.ciphertext.length
      })
      const snapshotKey = snapshotObjectKey(candidate.id, calendarDate)
      const manifestKey = manifestObjectKey(candidate.id, calendarDate)
      const manifestBody = Buffer.from(JSON.stringify(manifest), 'utf8')
      assertObjectUpload(snapshotKey, packed.ciphertext)
      assertObjectUpload(manifestKey, manifestBody)
      await deps.store.putObject(snapshotKey, packed.ciphertext, 'application/octet-stream')
      await deps.store.putObject(manifestKey, manifestBody, 'application/json')
      const removed = await applyRetention(deps.store, candidate.id, calendarDate)
      ok.push(candidate.id)
      deps.log?.(
        `[backup] ok tenant=${candidate.id} date=${calendarDate} rows=${packed.rowTotal} removed=${removed} ms=${Date.now() - started}`
      )
    } catch (err) {
      const failure = toFailure(candidate.id, err)
      failed.push(failure)
      deps.log?.(
        `[backup] fail tenant=${candidate.id} stage=${failure.stage} code=${failure.code} ms=${Date.now() - started}`
      )
    }
  }

  if (failed.length > 0) {
    const notify = deps.notify ?? notifyBackupFailures
    try {
      const mailed = await notify(failed)
      if (!mailed.sent) {
        deps.log?.(`[backup] mail-skipped code=${mailed.code ?? 'MAIL_NOT_SENT'}`)
      }
    } catch {
      deps.log?.('[backup] mail-failed code=MAIL_FAILED')
    }
  }

  deps.log?.(
    `[backup] done date=${calendarDate} ok=${ok.length} failed=${failed.length} skippedDemo=${skippedDemo.length}`
  )
  return { calendarDate, ok, failed, skippedDemo, skippedMissing }
}
