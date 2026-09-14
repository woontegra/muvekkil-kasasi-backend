import type { ParaBirimi, Prisma, VekaletTaksitOdemeDurumu } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'

/** Tahsilat varken para birimi değişikliği — API 409 gövdesi. */
export const VEKALET_CURRENCY_CHANGE_FORBIDDEN_MESSAGE =
  'Bu vekalet ücretine tahsilat işlendiği için para birimi değiştirilemez. Değiştirmek için önce ilgili tahsilatları iptal etmelisiniz.'

export const VEKALET_PLACEHOLDER_INCONSISTENT_MESSAGE =
  'Bu vekalet kaydı tutarsız görünüyor (tutar 0 ancak tahsilat veya pozitif tutarlı taksit var). Kayıt değiştirilmedi; destek ile iletişime geçin.'

export type VekaletUpsertMode = 'create' | 'initialize' | 'edit'

/** Create vs update ayrımı — yalnızca kalıcı kayıt kimliği. */
export function isPersistedVekaletUcreti<T extends { id?: string | null }>(
  ucret: T | null | undefined
): ucret is T & { id: string } {
  return typeof ucret?.id === 'string' && ucret.id.length > 0
}

export function decimalToNumber(d: Prisma.Decimal | number | string): number {
  const n = typeof d === 'number' ? d : Number(d)
  return Number.isFinite(n) ? n : 0
}

export function hasMeaningfulPositiveTaksitPlan(
  taksitler: ReadonlyArray<{ tutar: Prisma.Decimal | number | string; odemeDurumu: VekaletTaksitOdemeDurumu | string }>
): boolean {
  return taksitler.some((t) => {
    if (t.odemeDurumu === 'IPTAL') return false
    return decimalToNumber(t.tutar) > 0
  })
}

/**
 * create | initialize | edit — initialize: sıfır tutarlı placeholder, ödeme/pozitif taksit yok.
 * Tutarsız placeholder → AppError 409.
 */
export function classifyVekaletUpsertMode(input: {
  existing: { id: string; toplamTutar: Prisma.Decimal | number | string } | null
  tahsilatSayisi: number
  taksitler: ReadonlyArray<{ tutar: Prisma.Decimal | number | string; odemeDurumu: VekaletTaksitOdemeDurumu | string }>
}): VekaletUpsertMode {
  if (!input.existing) return 'create'
  const toplam = decimalToNumber(input.existing.toplamTutar)
  const hasTahsilat = input.tahsilatSayisi > 0
  const meaningfulTaksit = hasMeaningfulPositiveTaksitPlan(input.taksitler)
  if (toplam <= 0) {
    if (hasTahsilat || meaningfulTaksit) {
      throw new AppError(409, VEKALET_PLACEHOLDER_INCONSISTENT_MESSAGE, 'VEKALET_PLACEHOLDER_INCONSISTENT')
    }
    return 'initialize'
  }
  return 'edit'
}

/** Edit’te PB değişimi cascade/409 gerektirir; create/initialize serbest. */
export function isVekaletParaBirimiUpdateDegisimi(input: {
  mode: VekaletUpsertMode
  mevcut: ParaBirimi
  hedef: ParaBirimi
}): boolean {
  if (input.mode !== 'edit') return false
  return input.mevcut !== input.hedef
}

/**
 * Aynı para birimi → izinli (no-op).
 * Farklı + tahsilat > 0 → 409.
 * Farklı + tahsilat yok → izinli (taksit PB cascade caller’da).
 */
export function assertVekaletParaBirimiDegisimiIzinli(input: {
  mevcut: ParaBirimi
  hedef: ParaBirimi
  tahsilatSayisi: number
}): void {
  if (input.mevcut === input.hedef) return
  if (input.tahsilatSayisi > 0) {
    throw new AppError(409, VEKALET_CURRENCY_CHANGE_FORBIDDEN_MESSAGE, 'CURRENCY_CHANGE_FORBIDDEN')
  }
}

/** Para birimi değişiyorsa bağlı taksitlerin PB’si de güncellenir (tutar dönüşümü yok). */
export function shouldCascadeVekaletTaksitParaBirimi(
  mevcut: ParaBirimi,
  hedef: ParaBirimi
): boolean {
  return mevcut !== hedef
}
