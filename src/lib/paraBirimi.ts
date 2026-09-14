import { ParaBirimi, Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'

export const PARA_BIRIMLERI = [ParaBirimi.TRY, ParaBirimi.USD, ParaBirimi.EUR] as const

export type ParaBirimiKod = (typeof PARA_BIRIMLERI)[number]

export const PARA_BIRIMI_SEMBOL: Record<ParaBirimi, string> = {
  TRY: '₺',
  USD: '$',
  EUR: '€'
}

/** Tutar ile ₺ arasında satır kırılmaz boşluk. */
export const MONEY_NBSP = '\u00A0'

/**
 * `toFixed(2)` stringinden tr-TR rakamlar — Decimal → Number dönüşümü yapmadan gösterim.
 * Örn. "121076.25" → "121.076,25"; "-2500.00" → "-2.500,00"
 */
export function formatFixed2AsTrDigits(fixed2: string): string {
  const neg = fixed2.startsWith('-')
  const body = neg ? fixed2.slice(1) : fixed2
  const [intRaw, fracRaw = '00'] = body.split('.')
  const frac = `${fracRaw}00`.slice(0, 2)
  const intFormatted = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${neg ? '-' : ''}${intFormatted},${frac}`
}

/**
 * Ürün para gösterim sözleşmesi (sunum).
 * TRY sağda NBSP ile; USD/EUR solda.
 */
export function formatMoneyDisplay(fixed2OrDecimal: Prisma.Decimal | string, currency: ParaBirimi): string {
  const fixed =
    fixed2OrDecimal instanceof Prisma.Decimal
      ? fixed2OrDecimal.toFixed(2)
      : (() => {
          const s = String(fixed2OrDecimal).trim()
          if (/^-?\d+(\.\d+)?$/.test(s)) {
            const n = new Prisma.Decimal(s)
            return n.toFixed(2)
          }
          return s
        })()
  const neg = fixed.startsWith('-')
  const absFixed = neg ? fixed.slice(1) : fixed
  const digits = formatFixed2AsTrDigits(absFixed)
  const sign = neg ? '-' : ''
  if (currency === ParaBirimi.TRY) {
    return `${sign}${digits}${MONEY_NBSP}₺`
  }
  if (currency === ParaBirimi.USD) {
    return `${sign}$${digits}`
  }
  return `${sign}€${digits}`
}

/** Eksik / boş gelen API alanı → TRY (geriye uyumluluk). */
export function resolveParaBirimi(raw: unknown): ParaBirimi {
  if (raw == null || raw === '') return ParaBirimi.TRY
  const s = String(raw).trim().toUpperCase()
  if (s === 'TRY' || s === 'USD' || s === 'EUR') return s as ParaBirimi
  throw new AppError(400, 'Geçersiz para birimi. TRY, USD veya EUR olmalıdır.', 'INVALID_CURRENCY')
}

export const paraBirimiZodEnum = ['TRY', 'USD', 'EUR'] as const

/** Para tutarı: 2 ondalık, Decimal (HALF_UP). */
export function roundMoney(value: Prisma.Decimal | string | number): Prisma.Decimal {
  const d = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value)
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

/** Kur: 8 ondalık hassasiyet. */
export function roundRate(value: Prisma.Decimal | string | number): Prisma.Decimal {
  const d = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value)
  return d.toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP)
}

export function moneyToApiString(value: Prisma.Decimal | string | number): string {
  return roundMoney(value).toFixed(2)
}

export function rateToApiString(value: Prisma.Decimal | string | number | null | undefined): string | null {
  if (value == null) return null
  return roundRate(value).toFixed(8)
}

export function parsePositiveMoney(
  raw: unknown,
  fieldLabel = 'Tutar'
): Prisma.Decimal {
  if (raw == null || raw === '') {
    throw new AppError(400, `${fieldLabel} zorunludur.`, 'INVALID_AMOUNT')
  }
  let n: Prisma.Decimal
  try {
    if (typeof raw === 'string') {
      const s = raw.trim()
      let normalized: string
      if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || (s.includes(',') && s.includes('.'))) {
        normalized = s.replace(/\./g, '').replace(',', '.')
      } else if (s.includes(',')) {
        normalized = s.replace(',', '.')
      } else {
        normalized = s
      }
      n = new Prisma.Decimal(normalized)
    } else {
      n = new Prisma.Decimal(raw as string | number)
    }
  } catch {
    throw new AppError(400, `${fieldLabel} geçersiz.`, 'INVALID_AMOUNT')
  }
  if (!n.isFinite() || n.lte(0)) {
    throw new AppError(400, `${fieldLabel} pozitif olmalıdır.`, 'INVALID_AMOUNT')
  }
  return roundMoney(n)
}

export type CrossPaymentInput = {
  alacakParaBirimi: ParaBirimi
  /** Kasaya giren tutar (ödeme PB). Verilmezse mahsup ile aynı varsayılır (aynı PB). */
  kasaTutari?: unknown
  odemeParaBirimi?: unknown
  /** Borçtan düşülecek (alacak PB). Ana `tutar` alanı. */
  mahsupTutari: unknown
  kalanBorc: Prisma.Decimal | string | number
}

export type ResolvedPayment = {
  alacakParaBirimi: ParaBirimi
  odemeParaBirimi: ParaBirimi
  /** Borçtan düşülen — alacak PB */
  mahsupTutari: Prisma.Decimal
  /** Kasaya yazılan — ödeme PB */
  kasaTutari: Prisma.Decimal
  kur: Prisma.Decimal | null
  kurBazParaBirimi: ParaBirimi | null
  kurKarsiParaBirimi: ParaBirimi | null
  kurOzeti: string | null
  isCrossCurrency: boolean
}

/**
 * Aynı PB: kasa = mahsup, kur yok.
 * Farklı PB: iki tutar zorunlu; kur = kasa / mahsup → «1 {alacak} = kur {odeme}».
 */
export function resolvePaymentAmounts(input: CrossPaymentInput): ResolvedPayment {
  const alacakParaBirimi = input.alacakParaBirimi
  const odemeParaBirimi = resolveParaBirimi(input.odemeParaBirimi ?? alacakParaBirimi)
  const mahsupTutari = parsePositiveMoney(input.mahsupTutari, 'Borçtan düşülecek tutar')
  const kalan = roundMoney(input.kalanBorc)

  if (mahsupTutari.gt(kalan)) {
    throw new AppError(
      400,
      `Mahsup tutarı kalan borcu (${formatMoneyDisplay(kalan, alacakParaBirimi)}) aşamaz.`,
      'MAHSUP_EXCEEDS_REMAINING'
    )
  }

  if (odemeParaBirimi === alacakParaBirimi) {
    const kasa =
      input.kasaTutari == null || input.kasaTutari === ''
        ? mahsupTutari
        : parsePositiveMoney(input.kasaTutari, 'Kasaya giren tutar')
    if (!kasa.eq(mahsupTutari)) {
      throw new AppError(
        400,
        'Aynı para biriminde kasaya giren tutar ile mahsup tutarı eşit olmalıdır.',
        'SAME_CURRENCY_AMOUNT_MISMATCH'
      )
    }
    return {
      alacakParaBirimi,
      odemeParaBirimi,
      mahsupTutari,
      kasaTutari: kasa,
      kur: null,
      kurBazParaBirimi: null,
      kurKarsiParaBirimi: null,
      kurOzeti: null,
      isCrossCurrency: false
    }
  }

  if (input.kasaTutari == null || input.kasaTutari === '') {
    throw new AppError(
      400,
      'Farklı para biriminde ödeme için kasaya giren tutar zorunludur.',
      'KASA_TUTARI_REQUIRED'
    )
  }
  const kasaTutari = parsePositiveMoney(input.kasaTutari, 'Kasaya giren tutar')
  const kur = roundRate(kasaTutari.div(mahsupTutari))
  if (!kur.isFinite() || kur.lte(0)) {
    throw new AppError(400, 'Uygulanan kur geçersiz.', 'INVALID_RATE')
  }

  return {
    alacakParaBirimi,
    odemeParaBirimi,
    mahsupTutari,
    kasaTutari,
    kur,
    kurBazParaBirimi: alacakParaBirimi,
    kurKarsiParaBirimi: odemeParaBirimi,
    kurOzeti: `1 ${alacakParaBirimi} = ${kur.toFixed(8)} ${odemeParaBirimi}`,
    isCrossCurrency: true
  }
}

/** Döviz dönüşümü: kaynak ≠ hedef; kur = hedef/kaynak → 1 kaynak = kur hedef. */
export function resolveDovizDonusum(opts: {
  kaynakParaBirimi: unknown
  hedefParaBirimi: unknown
  kaynakTutar: unknown
  hedefTutar: unknown
}): {
  kaynakParaBirimi: ParaBirimi
  hedefParaBirimi: ParaBirimi
  kaynakTutar: Prisma.Decimal
  hedefTutar: Prisma.Decimal
  kur: Prisma.Decimal
  kurOzeti: string
} {
  const kaynakParaBirimi = resolveParaBirimi(opts.kaynakParaBirimi)
  const hedefParaBirimi = resolveParaBirimi(opts.hedefParaBirimi)
  if (kaynakParaBirimi === hedefParaBirimi) {
    throw new AppError(400, 'Kaynak ve hedef para birimi aynı olamaz.', 'SAME_CURRENCY_CONVERSION')
  }
  const kaynakTutar = parsePositiveMoney(opts.kaynakTutar, 'Kaynak tutar')
  const hedefTutar = parsePositiveMoney(opts.hedefTutar, 'Hedef tutar')
  const kur = roundRate(hedefTutar.div(kaynakTutar))
  if (!kur.isFinite() || kur.lte(0)) {
    throw new AppError(400, 'Uygulanan kur geçersiz.', 'INVALID_RATE')
  }
  return {
    kaynakParaBirimi,
    hedefParaBirimi,
    kaynakTutar,
    hedefTutar,
    kur,
    kurOzeti: `1 ${kaynakParaBirimi} = ${kur.toFixed(8)} ${hedefParaBirimi}`
  }
}

export function assertGiderParaBirimiTry(paraBirimi: ParaBirimi): void {
  if (paraBirimi !== ParaBirimi.TRY) {
    throw new AppError(
      400,
      'Ofis kasası giderleri yalnızca Türk Lirası (TRY) cinsinden kaydedilebilir.',
      'GIDER_TRY_ONLY'
    )
  }
}

export function formatKurOzeti(
  baz: ParaBirimi,
  karsi: ParaBirimi,
  kur: Prisma.Decimal | string | number
): string {
  return `1 ${baz} = ${roundRate(kur).toFixed(8)} ${karsi}`
}
