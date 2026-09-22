/**
 * Finansal dönem aralığı — Europe/Istanbul takvim günü.
 * Kartlar ve tablo aynı bas/bit kullanır.
 */
import { ymdTr, addDaysYmd, TZ } from '../tahsilatBildirim/time.js'

export { TZ as FINANCE_TZ }

export type FinancePeriodPreset =
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'LAST_3_MONTHS'
  | 'LAST_6_MONTHS'
  | 'LAST_12_MONTHS'
  | 'THIS_YEAR'
  | 'ALL_TIME'
  | 'CUSTOM'

export type FinancePeriodRange = {
  preset: FinancePeriodPreset
  /** YYYY-MM-DD inclusive; null = sınırsız */
  bas: string | null
  /** YYYY-MM-DD inclusive; null = sınırsız */
  bit: string | null
  etiket: string
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const s = (ymd ?? '').trim().slice(0, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!match) return null
  const y = Number(match[1])
  const mo = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || day < 1 || day > 31) return null
  return { y, m: mo, d: day }
}

/** Istanbul YMD parçaları. */
export function istanbulParts(ref: Date = new Date()): { y: number; m: number; d: number; ymd: string } {
  const ymd = ymdTr(ref)
  const p = parseYmd(ymd)!
  return { ...p, ymd }
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Ayın ilk günü → bugün (Istanbul). */
function thisMonthRange(now: Date): { bas: string; bit: string } {
  const { y, m, ymd } = istanbulParts(now)
  return { bas: `${y}-${pad2(m)}-01`, bit: ymd }
}

/** Önceki takvim ayının tamamı. */
function lastMonthRange(now: Date): { bas: string; bit: string } {
  const { y, m } = istanbulParts(now)
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
  const last = lastDayOfMonth(prev.y, prev.m)
  return {
    bas: `${prev.y}-${pad2(prev.m)}-01`,
    bit: `${prev.y}-${pad2(prev.m)}-${pad2(last)}`
  }
}

/** Bugün dahil geriye N ay (yaklaşık: N*30 gün değil — takvim: aynı gün N ay önce). */
function lastNMonthsRange(now: Date, n: number): { bas: string; bit: string } {
  const { y, m, d, ymd } = istanbulParts(now)
  let ty = y
  let tm = m - n
  while (tm <= 0) {
    tm += 12
    ty -= 1
  }
  const maxD = lastDayOfMonth(ty, tm)
  const day = Math.min(d, maxD)
  return { bas: `${ty}-${pad2(tm)}-${pad2(day)}`, bit: ymd }
}

function thisYearRange(now: Date): { bas: string; bit: string } {
  const { y, ymd } = istanbulParts(now)
  return { bas: `${y}-01-01`, bit: ymd }
}

const PRESET_LABELS: Record<FinancePeriodPreset, string> = {
  THIS_MONTH: 'Bu Ay',
  LAST_MONTH: 'Geçen Ay',
  LAST_3_MONTHS: 'Son 3 Ay',
  LAST_6_MONTHS: 'Son 6 Ay',
  LAST_12_MONTHS: 'Son 12 Ay',
  THIS_YEAR: 'Bu Yıl',
  ALL_TIME: 'Tüm Zamanlar',
  CUSTOM: 'Özel Tarih'
}

export function resolveFinancePeriodRange(
  preset: FinancePeriodPreset,
  opts?: { now?: Date; bas?: string | null; bit?: string | null }
): FinancePeriodRange {
  const now = opts?.now ?? new Date()
  if (preset === 'ALL_TIME') {
    return { preset, bas: null, bit: null, etiket: PRESET_LABELS.ALL_TIME }
  }
  if (preset === 'CUSTOM') {
    const bas = opts?.bas?.trim().slice(0, 10) || null
    const bit = opts?.bit?.trim().slice(0, 10) || null
    return { preset, bas, bit, etiket: PRESET_LABELS.CUSTOM }
  }
  let range: { bas: string; bit: string }
  switch (preset) {
    case 'THIS_MONTH':
      range = thisMonthRange(now)
      break
    case 'LAST_MONTH':
      range = lastMonthRange(now)
      break
    case 'LAST_3_MONTHS':
      range = lastNMonthsRange(now, 3)
      break
    case 'LAST_6_MONTHS':
      range = lastNMonthsRange(now, 6)
      break
    case 'LAST_12_MONTHS':
      range = lastNMonthsRange(now, 12)
      break
    case 'THIS_YEAR':
      range = thisYearRange(now)
      break
    default:
      range = thisMonthRange(now)
  }
  return { preset, bas: range.bas, bit: range.bit, etiket: PRESET_LABELS[preset] }
}

/**
 * Manuel bas/bit değişince preset CUSTOM olur.
 * Bilinen preset aralığıyla birebir örtüşüyorsa o preset korunabilir (opsiyonel).
 */
export function coercePresetForManualDates(
  bas: string | null | undefined,
  bit: string | null | undefined,
  now: Date = new Date()
): FinancePeriodPreset {
  const b = bas?.trim().slice(0, 10) || null
  const e = bit?.trim().slice(0, 10) || null
  if (!b && !e) return 'ALL_TIME'
  const presets: FinancePeriodPreset[] = [
    'THIS_MONTH',
    'LAST_MONTH',
    'LAST_3_MONTHS',
    'LAST_6_MONTHS',
    'LAST_12_MONTHS',
    'THIS_YEAR'
  ]
  for (const p of presets) {
    const r = resolveFinancePeriodRange(p, { now })
    if (r.bas === b && r.bit === e) return p
  }
  return 'CUSTOM'
}

/** Inclusive Istanbul day bounds → Date for Prisma (TR offset). */
export function ymdToIstanbulStart(ymd: string): Date {
  return new Date(`${ymd.trim().slice(0, 10)}T00:00:00+03:00`)
}

export function ymdToIstanbulEndExclusive(ymd: string): Date {
  const next = addDaysYmd(ymd.trim().slice(0, 10), 1)
  return new Date(`${next}T00:00:00+03:00`)
}

export function financePeriodToDateFilter(range: FinancePeriodRange): {
  gte?: Date
  lt?: Date
} | undefined {
  if (!range.bas && !range.bit) return undefined
  return {
    ...(range.bas ? { gte: ymdToIstanbulStart(range.bas) } : {}),
    ...(range.bit ? { lt: ymdToIstanbulEndExclusive(range.bit) } : {})
  }
}

export function presetLabel(preset: FinancePeriodPreset): string {
  return PRESET_LABELS[preset]
}
