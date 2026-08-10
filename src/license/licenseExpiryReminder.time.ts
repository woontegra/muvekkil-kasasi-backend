import type { LicenseExpiryReminderType } from '@prisma/client'
import { ymdTr } from '../tahsilatBildirim/time.js'

export const LICENSE_EXPIRY_REMINDER_THRESHOLDS = [30, 7, 1] as const
export type LicenseExpiryReminderThreshold = (typeof LICENSE_EXPIRY_REMINDER_THRESHOLDS)[number]

export function licenseEndDateKey(end: Date): Date {
  const ymd = ymdTr(end)
  return new Date(`${ymd}T12:00:00+03:00`)
}

/** Kalan gün — Europe/Istanbul takvim günü (license.service ile uyumlu). */
export function calendarDaysUntilLicenseEnd(end: Date, ref: Date = new Date()): number {
  const endYmd = ymdTr(end)
  const todayYmd = ymdTr(ref)
  const endD = new Date(`${endYmd}T12:00:00+03:00`)
  const todayD = new Date(`${todayYmd}T12:00:00+03:00`)
  return Math.round((endD.getTime() - todayD.getTime()) / 86_400_000)
}

export function daysForReminderType(type: LicenseExpiryReminderType): LicenseExpiryReminderThreshold {
  if (type === 'D30') return 30
  if (type === 'D7') return 7
  return 1
}

export function isEligibleForLicenseExpiryReminder(input: {
  demoMu: boolean
  aktifMi: boolean
  lisansDurumu: string
  lisansBitisTarihi: Date | null
}): boolean {
  if (input.demoMu) return false
  if (!input.aktifMi) return false
  if (input.lisansDurumu !== 'AKTIF') return false
  if (!input.lisansBitisTarihi) return false
  return true
}

export type DueLicenseExpiryReminder = {
  reminderType: LicenseExpiryReminderType
  displayDays: LicenseExpiryReminderThreshold
}

/**
 * Tek çalıştırmada en fazla bir reminder seçer (backlog yok).
 * Öncelik: D1 > D7 > D30. Her tip yalnızca henüz SENT değilse.
 */
export function resolveDueReminderType(
  daysRemaining: number,
  alreadySent: ReadonlySet<LicenseExpiryReminderType>
): DueLicenseExpiryReminder | null {
  if (daysRemaining < 0) return null
  if (daysRemaining > 30) return null

  if (daysRemaining <= 1) {
    if (alreadySent.has('D1')) return null
    return { reminderType: 'D1', displayDays: 1 }
  }
  if (daysRemaining <= 7) {
    if (alreadySent.has('D7')) return null
    return { reminderType: 'D7', displayDays: 7 }
  }
  if (daysRemaining <= 30) {
    if (alreadySent.has('D30')) return null
    return { reminderType: 'D30', displayDays: 30 }
  }
  return null
}
