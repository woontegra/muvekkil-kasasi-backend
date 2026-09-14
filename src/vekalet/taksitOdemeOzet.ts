/**
 * Kanonik taksit ödeme özeti — UI, modal ve create/update validator aynı hesabı kullanır.
 * Aktif = iptalAt null VE (ofis bağlantısı yoksa OK | ofis.deletedAt null).
 */
import { ParaBirimi, Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { formatMoneyDisplay, moneyToApiString, roundMoney } from '../lib/paraBirimi.js'
import { filterAktifTahsilatOdemeleri, isTahsilatOdemeAktif } from '../lib/tahsilatOdemeAktif.js'

export type TaksitOdemeAktiflikRow = {
  id: string
  tutar: Prisma.Decimal
  iptalAt?: Date | null
  ofisKasaHareketId?: string | null
  ofisKasaHareket?: { deletedAt: Date | null } | null
}

export type TaksitOdemeOzeti = {
  taksitTutari: Prisma.Decimal
  odenenToplam: Prisma.Decimal
  kalanTutar: Prisma.Decimal
  aktifOdemeSayisi: number
  taksitTutariStr: string
  odenenToplamStr: string
  kalanTutarStr: string
}

export function sumAktifOdemeTutarDecimal(odemeler: TaksitOdemeAktiflikRow[]): Prisma.Decimal {
  let sum = new Prisma.Decimal(0)
  for (const o of filterAktifTahsilatOdemeleri(odemeler)) {
    sum = sum.plus(o.tutar)
  }
  return roundMoney(sum)
}

export function computeTaksitOdemeOzeti(
  taksitTutari: Prisma.Decimal,
  odemeler: TaksitOdemeAktiflikRow[],
  opts?: { excludeOdemeId?: string }
): TaksitOdemeOzeti {
  const rows = opts?.excludeOdemeId
    ? odemeler.filter((o) => o.id !== opts.excludeOdemeId)
    : odemeler
  const aktif = filterAktifTahsilatOdemeleri(rows)
  const odenenToplam = sumAktifOdemeTutarDecimal(rows)
  const kalanRaw = taksitTutari.minus(odenenToplam)
  const kalanTutar = kalanRaw.isNegative() ? new Prisma.Decimal(0) : roundMoney(kalanRaw)
  return {
    taksitTutari: roundMoney(taksitTutari),
    odenenToplam,
    kalanTutar,
    aktifOdemeSayisi: aktif.length,
    taksitTutariStr: moneyToApiString(taksitTutari),
    odenenToplamStr: moneyToApiString(odenenToplam),
    kalanTutarStr: moneyToApiString(kalanTutar)
  }
}

export function assertExpectedKalanMatches(
  expectedKalan: Prisma.Decimal | string | number | null | undefined,
  actual: TaksitOdemeOzeti,
  paraBirimi: ParaBirimi | string
): void {
  if (expectedKalan == null || expectedKalan === '') return
  const exp = roundMoney(expectedKalan)
  if (!exp.eq(actual.kalanTutar)) {
    const pb =
      paraBirimi === ParaBirimi.USD || paraBirimi === ParaBirimi.EUR || paraBirimi === ParaBirimi.TRY
        ? paraBirimi
        : ParaBirimi.TRY
    throw new AppError(
      409,
      `Ödeme özeti güncelliğini yitirdi. Güncel kalan: ${formatMoneyDisplay(actual.kalanTutar, pb)}.`,
      'STALE_PAYMENT_SUMMARY',
      {
        odenenToplam: actual.odenenToplamStr,
        kalanTutar: actual.kalanTutarStr,
        taksitTutari: actual.taksitTutariStr
      }
    )
  }
}

export { isTahsilatOdemeAktif, filterAktifTahsilatOdemeleri }
