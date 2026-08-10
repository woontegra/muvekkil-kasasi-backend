/**
 * Lisans bitiş hatırlatma — saf fonksiyon doğrulaması (DB/mail yok).
 * Çalıştır: npm run test:license-reminder
 */
import assert from 'node:assert/strict'
import type { LicenseExpiryReminderType } from '@prisma/client'
import {
  calendarDaysUntilLicenseEnd,
  isEligibleForLicenseExpiryReminder,
  licenseEndDateKey,
  resolveDueReminderType
} from '../src/license/licenseExpiryReminder.time.js'

function isoAtTrNoon(ymd: string): Date {
  return new Date(`${ymd}T12:00:00+03:00`)
}

function refAtTrNoon(ymd: string): Date {
  return new Date(`${ymd}T12:00:00+03:00`)
}

function sent(...types: LicenseExpiryReminderType[]): Set<LicenseExpiryReminderType> {
  return new Set(types)
}

// 1) 31 gün kaldı → mail yok
{
  const end = isoAtTrNoon('2026-12-31')
  const ref = refAtTrNoon('2026-11-30')
  assert.equal(calendarDaysUntilLicenseEnd(end, ref), 31)
  assert.equal(resolveDueReminderType(31, sent()), null)
}

// 2) 30 gün kaldı → D30
{
  const end = isoAtTrNoon('2026-12-31')
  const ref = refAtTrNoon('2026-12-01')
  assert.equal(calendarDaysUntilLicenseEnd(end, ref), 30)
  const due = resolveDueReminderType(30, sent())
  assert.equal(due?.reminderType, 'D30')
  assert.equal(due?.displayDays, 30)
}

// 3) 30. gün cron kaçtı, 29 gün → D30
{
  const due = resolveDueReminderType(29, sent())
  assert.equal(due?.reminderType, 'D30')
}

// 4) D30 gönderildi, 28 gün → tekrar yok
{
  const due = resolveDueReminderType(28, sent('D30'))
  assert.equal(due, null)
}

// 5) 8 gün kaldı, D30 henüz gönderilmemiş → D30
{
  const end = isoAtTrNoon('2026-12-31')
  const ref = refAtTrNoon('2026-12-23')
  assert.equal(calendarDaysUntilLicenseEnd(end, ref), 8)
  const due = resolveDueReminderType(8, sent())
  assert.equal(due?.reminderType, 'D30')
}

// 5b) 8 gün, D30 zaten gönderilmiş → D7 penceresi değil, yok
assert.equal(resolveDueReminderType(8, sent('D30')), null)

// 6) 7 gün kaldı → D7
{
  const end = isoAtTrNoon('2026-12-31')
  const ref = refAtTrNoon('2026-12-24')
  assert.equal(calendarDaysUntilLicenseEnd(end, ref), 7)
  const due = resolveDueReminderType(7, sent('D30'))
  assert.equal(due?.reminderType, 'D7')
}

// 7) 7. gün cron kaçtı, 6 gün → D7
{
  const due = resolveDueReminderType(6, sent('D30'))
  assert.equal(due?.reminderType, 'D7')
}

// 8) ilk çalışma 6 gün → yalnız D7, D30 yok
{
  const due = resolveDueReminderType(6, sent())
  assert.equal(due?.reminderType, 'D7')
}

// 9) 1 gün kaldı → D1
{
  const end = isoAtTrNoon('2026-12-31')
  const ref = refAtTrNoon('2026-12-30')
  assert.equal(calendarDaysUntilLicenseEnd(end, ref), 1)
  const due = resolveDueReminderType(1, sent('D30', 'D7'))
  assert.equal(due?.reminderType, 'D1')
}

// 10) ilk çalışma 1 gün → yalnız D1
{
  const due = resolveDueReminderType(1, sent())
  assert.equal(due?.reminderType, 'D1')
}

// 11) lisans süresi dolmuş → yok
assert.equal(resolveDueReminderType(-1, sent()), null)

// 12) demo kullanıcı → uygun değil
assert.equal(
  isEligibleForLicenseExpiryReminder({
    demoMu: true,
    aktifMi: true,
    lisansDurumu: 'AKTIF',
    lisansBitisTarihi: new Date()
  }),
  false
)

// 13) aktif lisanslı uygun
assert.equal(
  isEligibleForLicenseExpiryReminder({
    demoMu: false,
    aktifMi: true,
    lisansDurumu: 'AKTIF',
    lisansBitisTarihi: new Date()
  }),
  true
)

// licenseEndDateKey tutarlılığı
{
  const end = isoAtTrNoon('2027-08-11')
  const key = licenseEndDateKey(end)
  assert.equal(key.toISOString(), '2027-08-11T09:00:00.000Z')
}

// eslint-disable-next-line no-console
console.info('[test:license-reminder] all assertions passed')
