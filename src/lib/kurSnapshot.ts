import { KurKaynagi, ParaBirimi, Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { roundMoney, roundRate, type ResolvedPayment } from './paraBirimi.js'
import { computePrimTryMatrahi, getTcmbPairRate } from './tcmbKur.service.js'

export type KurSnapshotInput = {
  odemeTarihi: Date
  payment: ResolvedPayment
  kurKaynagi?: string | null
  tcmbKurTarihi?: string | null
  tcmbReferansKur?: string | number | null
}

export type KurSnapshotResolved = {
  kurKaynagi: KurKaynagi | null
  tcmbKurTarihi: Date | null
  tcmbReferansKur: Prisma.Decimal | null
  primTryMatrahi: Prisma.Decimal
}

function ymdFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYmdDate(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) throw new AppError(400, 'TCMB kur tarihi geçersiz.', 'INVALID_TCMB_DATE')
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`)
}

/**
 * Ödeme kaydı için TCMB/manuel kur snapshot + prim TRY matrahı.
 * Sonraki TCMB değişimleri bu snapshot’ı değiştirmez.
 */
export async function resolvePaymentKurSnapshot(input: KurSnapshotInput): Promise<KurSnapshotResolved> {
  const p = input.payment
  const islemYmd = ymdFromDate(input.odemeTarihi)

  let kurKaynagi: KurKaynagi | null = null
  let tcmbKurTarihi: Date | null = null
  let tcmbReferansKur: Prisma.Decimal | null = null

  const needsFxMeta = p.isCrossCurrency || p.odemeParaBirimi !== ParaBirimi.TRY

  if (needsFxMeta) {
    const rawSrc = (input.kurKaynagi ?? '').toString().toUpperCase()
    kurKaynagi = rawSrc === 'MANUEL' ? KurKaynagi.MANUEL : rawSrc === 'TCMB' ? KurKaynagi.TCMB : null

    if (input.tcmbReferansKur != null && input.tcmbReferansKur !== '') {
      tcmbReferansKur = roundRate(new Prisma.Decimal(String(input.tcmbReferansKur).replace(',', '.')))
    }
    if (input.tcmbKurTarihi) {
      tcmbKurTarihi = parseYmdDate(input.tcmbKurTarihi)
    }

    // Çapraz ödemede referans çift: alacak → ödeme; prim için ayrıca ödeme→TRY gerekir
    if (!tcmbReferansKur || !tcmbKurTarihi || !kurKaynagi) {
      const pair = await getTcmbPairRate(p.alacakParaBirimi, p.odemeParaBirimi, { date: islemYmd })
      if (pair) {
        if (!tcmbReferansKur) tcmbReferansKur = roundRate(pair.dovizAlis)
        if (!tcmbKurTarihi) tcmbKurTarihi = parseYmdDate(pair.bulunanTcmbKurTarihi)
        if (!kurKaynagi) kurKaynagi = KurKaynagi.TCMB
      } else if (!kurKaynagi) {
        kurKaynagi = KurKaynagi.MANUEL
      }
    }
  }

  // Prim TRY matrahı
  let odemePbTryRate: Prisma.Decimal | null = null
  if (p.odemeParaBirimi === ParaBirimi.TRY) {
    odemePbTryRate = null
  } else if (p.isCrossCurrency && p.kurBazParaBirimi === p.odemeParaBirimi && p.kurKarsiParaBirimi === ParaBirimi.TRY && p.kur) {
    // nadiren: kur yönü ödeme→TRY ise
    odemePbTryRate = p.kur
  } else if (p.isCrossCurrency && p.kurBazParaBirimi && p.kurKarsiParaBirimi === p.odemeParaBirimi && p.kurBazParaBirimi === ParaBirimi.TRY && p.kur) {
    // 1 TRY = X odeme → odeme→TRY = 1/X
    odemePbTryRate = roundRate(new Prisma.Decimal(1).div(p.kur))
  } else {
    // Standart: TCMB’den ödeme PB / TRY alış (veya client’ın gönderdiği USD/TRY referansı)
    const tryPair = await getTcmbPairRate(p.odemeParaBirimi, ParaBirimi.TRY, { date: islemYmd })
    if (tryPair) {
      odemePbTryRate = roundRate(tryPair.dovizAlis)
      if (!tcmbKurTarihi) tcmbKurTarihi = parseYmdDate(tryPair.bulunanTcmbKurTarihi)
      // Aynı PB USD ödemede tcmbReferansKur = USD/TRY önerisi
      if (!p.isCrossCurrency && !tcmbReferansKur) {
        tcmbReferansKur = odemePbTryRate
        kurKaynagi = kurKaynagi ?? KurKaynagi.TCMB
      }
    } else if (tcmbReferansKur && (p.odemeParaBirimi === ParaBirimi.USD || p.odemeParaBirimi === ParaBirimi.EUR) && !p.isCrossCurrency) {
      odemePbTryRate = tcmbReferansKur
    } else if (p.isCrossCurrency && p.kur && p.alacakParaBirimi === ParaBirimi.TRY) {
      // 1 TRY mahsup = kur odeme → odeme/TRY ters
      odemePbTryRate = roundRate(new Prisma.Decimal(1).div(p.kur))
    }
  }

  // Çapraz: kasa TRY ise doğrudan; değilse rate zorunlu
  let primTryMatrahi: Prisma.Decimal
  try {
    primTryMatrahi = computePrimTryMatrahi({
      odemeParaBirimi: p.odemeParaBirimi,
      kasaTutari: p.kasaTutari,
      odemePbTryRate
    })
  } catch {
    throw new AppError(
      400,
      'Yabancı para tahsilatı için TRY prim matrahı hesaplanamadı. TCMB kuru alınamadıysa uygulanacak kuru / TRY karşılığını girin.',
      'PRIM_TRY_RATE_REQUIRED'
    )
  }

  return {
    kurKaynagi,
    tcmbKurTarihi,
    tcmbReferansKur,
    primTryMatrahi: roundMoney(primTryMatrahi)
  }
}

export function ymdToDateOnly(ymd: string | null | undefined): Date | null {
  if (!ymd) return null
  return parseYmdDate(ymd)
}

export type DovizDonusumKurInput = {
  tarih: Date
  kaynakParaBirimi: ParaBirimi
  hedefParaBirimi: ParaBirimi
  kurKaynagi?: string | null
  tcmbKurTarihi?: string | null
  tcmbReferansKur?: string | number | null
}

export type DovizDonusumKurResolved = {
  kurKaynagi: KurKaynagi | null
  tcmbKurTarihi: Date | null
  tcmbReferansKur: Prisma.Decimal | null
}

/** Ofis döviz dönüşümü için TCMB/manuel kur snapshot. */
export async function resolveDovizDonusumKurMeta(input: DovizDonusumKurInput): Promise<DovizDonusumKurResolved> {
  const islemYmd = ymdFromDate(input.tarih)

  let kurKaynagi: KurKaynagi | null = null
  let tcmbKurTarihi: Date | null = null
  let tcmbReferansKur: Prisma.Decimal | null = null

  const rawSrc = (input.kurKaynagi ?? '').toString().toUpperCase()
  kurKaynagi = rawSrc === 'MANUEL' ? KurKaynagi.MANUEL : rawSrc === 'TCMB' ? KurKaynagi.TCMB : null

  if (input.tcmbReferansKur != null && input.tcmbReferansKur !== '') {
    tcmbReferansKur = roundRate(new Prisma.Decimal(String(input.tcmbReferansKur).replace(',', '.')))
  }
  if (input.tcmbKurTarihi) {
    tcmbKurTarihi = parseYmdDate(input.tcmbKurTarihi)
  }

  if (kurKaynagi === KurKaynagi.TCMB && (!tcmbReferansKur || !tcmbKurTarihi)) {
    const pair = await getTcmbPairRate(input.kaynakParaBirimi, input.hedefParaBirimi, { date: islemYmd })
    if (pair) {
      if (!tcmbReferansKur) tcmbReferansKur = roundRate(pair.dovizAlis)
      if (!tcmbKurTarihi) tcmbKurTarihi = parseYmdDate(pair.bulunanTcmbKurTarihi)
    }
  } else if (!kurKaynagi && (tcmbReferansKur || tcmbKurTarihi)) {
    kurKaynagi = KurKaynagi.MANUEL
  }

  return { kurKaynagi, tcmbKurTarihi, tcmbReferansKur }
}
