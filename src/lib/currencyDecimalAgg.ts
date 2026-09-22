/**
 * Para birimi bazlı Decimal kova — ofis/dosya özetleri için ortak.
 */
import { Prisma } from '@prisma/client'
import { moneyToApiString, PARA_BIRIMLERI, type ParaBirimiKod } from './paraBirimi.js'

export type CurrencyAggBucket = {
  gelir: Prisma.Decimal
  gider: Prisma.Decimal
  duzeltme: Prisma.Decimal
  dovizCikis: Prisma.Decimal
  dovizGiris: Prisma.Decimal
}

export function emptyCurrencyAgg(): Record<ParaBirimiKod, CurrencyAggBucket> {
  const z = () => new Prisma.Decimal(0)
  const one = (): CurrencyAggBucket => ({
    gelir: z(),
    gider: z(),
    duzeltme: z(),
    dovizCikis: z(),
    dovizGiris: z()
  })
  return { TRY: one(), USD: one(), EUR: one() }
}

export function netFromBucket(b: CurrencyAggBucket): Prisma.Decimal {
  return b.gelir.minus(b.gider).plus(b.duzeltme).minus(b.dovizCikis).plus(b.dovizGiris)
}

export function applyOfisIslemToAgg(
  buckets: Record<ParaBirimiKod, CurrencyAggBucket>,
  islemTipi: string,
  paraBirimi: string,
  tutar: Prisma.Decimal
): void {
  const pb = (PARA_BIRIMLERI as readonly string[]).includes(paraBirimi)
    ? (paraBirimi as ParaBirimiKod)
    : null
  if (!pb) return
  const b = buckets[pb]
  switch (islemTipi) {
    case 'GELIR':
      b.gelir = b.gelir.plus(tutar)
      break
    case 'GIDER':
      b.gider = b.gider.plus(tutar)
      break
    case 'DUZELTME':
      b.duzeltme = b.duzeltme.plus(tutar)
      break
    case 'DOVIZ_CIKIS':
      b.dovizCikis = b.dovizCikis.plus(tutar)
      break
    case 'DOVIZ_GIRIS':
      b.dovizGiris = b.dovizGiris.plus(tutar)
      break
    default:
      break
  }
}

export function applyKasaTipToAgg(
  buckets: Record<ParaBirimiKod, CurrencyAggBucket>,
  tip: string,
  paraBirimi: string,
  tutar: Prisma.Decimal
): void {
  const pb = (PARA_BIRIMLERI as readonly string[]).includes(paraBirimi)
    ? (paraBirimi as ParaBirimiKod)
    : 'TRY'
  const b = buckets[pb]
  if (tip === 'AVANS_GIRISI') b.gelir = b.gelir.plus(tutar)
  else if (tip === 'MASRAF') b.gider = b.gider.plus(tutar)
  else if (tip === 'DUZELTME') b.duzeltme = b.duzeltme.plus(tutar)
}

export function bucketToApi(b: CurrencyAggBucket): {
  toplamGelir: string
  toplamGider: string
  toplamDuzeltme: string
  kasaBakiyesi: string
} {
  return {
    toplamGelir: moneyToApiString(b.gelir),
    toplamGider: moneyToApiString(b.gider),
    toplamDuzeltme: moneyToApiString(b.duzeltme),
    kasaBakiyesi: moneyToApiString(netFromBucket(b))
  }
}

export function periodBucketToApi(b: CurrencyAggBucket): {
  donemGelir: string
  donemGider: string
  donemDuzeltmeEtkisi: string
  donemNet: string
} {
  return {
    donemGelir: moneyToApiString(b.gelir),
    donemGider: moneyToApiString(b.gider),
    donemDuzeltmeEtkisi: moneyToApiString(b.duzeltme),
    donemNet: moneyToApiString(netFromBucket(b))
  }
}
