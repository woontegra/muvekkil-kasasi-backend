export type AccountingPeriodMode = 'MONTHLY' | 'YEARLY'

export type AccountingPeriod = {
  mode: AccountingPeriodMode
  bas: string
  bit: string
  etiket: string
}

const AY_ADLARI = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
] as const

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function toLocalYmd(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
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

export function getAccountingPeriod(mode: AccountingPeriodMode, referenceDate: Date | string = new Date()): AccountingPeriod {
  const ymd = typeof referenceDate === 'string' ? referenceDate.slice(0, 10) : toLocalYmd(referenceDate)
  const p = parseYmd(ymd) ?? parseYmd(toLocalYmd())!
  if (mode === 'YEARLY') {
    return { mode, bas: `${p.y}-01-01`, bit: `${p.y}-12-31`, etiket: `${p.y} Yılı` }
  }
  const lastDay = new Date(p.y, p.m, 0).getDate()
  return {
    mode,
    bas: `${p.y}-${pad2(p.m)}-01`,
    bit: `${p.y}-${pad2(p.m)}-${pad2(lastDay)}`,
    etiket: `${AY_ADLARI[p.m - 1]} ${p.y}`
  }
}

export function getPreviousAccountingPeriod(period: AccountingPeriod): AccountingPeriod {
  const p = parseYmd(period.bas)
  if (!p) return period
  if (period.mode === 'YEARLY') {
    return getAccountingPeriod('YEARLY', `${p.y - 1}-01-01`)
  }
  const prev = new Date(p.y, p.m - 2, 1)
  return getAccountingPeriod('MONTHLY', toLocalYmd(prev))
}

export function getNextAccountingPeriod(period: AccountingPeriod): AccountingPeriod | null {
  const current = getAccountingPeriod(period.mode)
  const p = parseYmd(period.bas)
  if (!p) return null
  let next: AccountingPeriod
  if (period.mode === 'YEARLY') {
    next = getAccountingPeriod('YEARLY', `${p.y + 1}-01-01`)
  } else {
    const n = new Date(p.y, p.m, 1)
    next = getAccountingPeriod('MONTHLY', toLocalYmd(n))
  }
  if (next.bas > current.bas) return null
  return next
}

export function canGoToNextAccountingPeriod(period: AccountingPeriod): boolean {
  return getNextAccountingPeriod(period) != null
}

export function isCurrentAccountingPeriod(period: AccountingPeriod, now: Date | string = new Date()): boolean {
  const cur = getAccountingPeriod(period.mode, now)
  return period.bas === cur.bas && period.bit === cur.bit
}
