const TZ = 'Europe/Istanbul'

/** YYYY-MM-DD in Europe/Istanbul. */
export function ymdTr(ref: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(ref)
}

/** Minutes since midnight in Europe/Istanbul (0–1439). */
export function minutesNowTr(ref: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(ref)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const h = hour === 24 ? 0 : hour
  return h * 60 + minute
}

/** Plan instant for a calendar day + minutes-from-midnight in Europe/Istanbul. */
export function planAtFromYmdAndMinutes(ymd: string, minutes: number): Date {
  const clamped = Math.max(0, Math.min(1439, Math.floor(minutes)))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return new Date(`${ymd}T${hh}:${mm}:00+03:00`)
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00+03:00`)
  d.setUTCDate(d.getUTCDate() + days)
  return ymdTr(d)
}

export { TZ }
