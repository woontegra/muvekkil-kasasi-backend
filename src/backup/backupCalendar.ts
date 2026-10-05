import { BackupTenantError } from './backupErrors.js'

const ISTANBUL = 'Europe/Istanbul'

export function istanbulCalendarDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ISTANBUL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now)
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  if (!year || !month || !day) {
    throw new BackupTenantError('CALENDAR_FAILED', 'calendar')
  }
  return `${year}-${month}-${day}`
}

export function addCalendarDays(ymd: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) throw new BackupTenantError('DATE_INVALID', 'calendar')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  utc.setUTCDate(utc.getUTCDate() + deltaDays)
  const y = utc.getUTCFullYear().toString().padStart(4, '0')
  const m = (utc.getUTCMonth() + 1).toString().padStart(2, '0')
  const d = utc.getUTCDate().toString().padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Bugün dahil tutulacak en eski takvim günü. */
export function retentionKeepFrom(todayYmd: string, keepDays = 15): string {
  if (!Number.isInteger(keepDays) || keepDays < 1) {
    throw new BackupTenantError('RETENTION_DAYS_INVALID', 'retention')
  }
  return addCalendarDays(todayYmd, -(keepDays - 1))
}
