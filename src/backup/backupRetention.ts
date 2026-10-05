import { retentionKeepFrom } from './backupCalendar.js'
import { BACKUP_OBJECT_KEY_RE, dailyPrefix, TENANT_UUID_RE } from './backupObjectKey.js'

export function selectRetentionDeletes(
  keys: readonly string[],
  tenantId: string,
  todayYmd: string,
  keepDays = 15
): string[] {
  if (!TENANT_UUID_RE.test(tenantId)) return []
  const keepFrom = retentionKeepFrom(todayYmd, keepDays)
  const prefix = dailyPrefix(tenantId)
  const doomed: string[] = []
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue
    const match = BACKUP_OBJECT_KEY_RE.exec(key)
    if (!match) continue
    if (match[1]!.toLowerCase() !== tenantId.toLowerCase()) continue
    const objectDate = match[2]!
    if (objectDate < keepFrom) doomed.push(key)
  }
  return doomed
}
