import { KasaHareketTipi, KasaOnayDurumu, OfisKasaIslemTipi, OfisKasaOnayDurumu, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import {
  type AccountingPeriodMode,
  getAccountingPeriod,
  toLocalYmd
} from '../lib/accountingPeriod.js'
import { moneyToApiString } from '../lib/paraBirimi.js'
import { manuelOfisGelirKaynakWhere } from '../lib/primTahsilatFilter.js'
import {
  type DecimalByCurrency,
  type KarlilikCurrency,
  type MoneyByCurrency,
  KARLILIK_CURRENCIES,
  addToDecimalByCurrency,
  emptyDecimalByCurrency,
  isNonZeroDecimal,
  netByCurrency,
  resolveKarlilikCurrency,
  sumKarlilikOfisGelirBuckets,
  toMoneyByCurrency,
  zeroDecimal
} from './karlilikOfisGelir.js'

export type DosyaMaliOzetPayload = {
  kararlastirilanVekalet: string
  tahsilEdilenVekalet: string
  kalanVekalet: string
  tahsilatOrani: number
  alinanMasrafAvansi: string
  toplamMasraf: string
  duzeltmeEtkisi: string
  /** Negatif DUZELTME kayıtlarının mutlak değer toplamı — müvekkile yapılan avans iadesi. */
  masrafAvansiIadesi: string
  kalanMasrafAvansi: string
  buroKarsiladigiGider: string
  netKazanc: string
}

export type DosyaMaliOzetResponse = {
  tumZamanlar: DosyaMaliOzetPayload
  buDonem: DosyaMaliOzetPayload | null
  donemEtiketi: string | null
}

async function computeForDosya(
  tenantId: string,
  dosyaId: string,
  dateFilter?: { gte: Date; lt: Date }
): Promise<DosyaMaliOzetPayload> {
  const kasaDateWhere = dateFilter ? { tarih: { gte: dateFilter.gte, lt: dateFilter.lt } } : {}
  const odemeDateWhere = dateFilter ? { odemeTarihi: { gte: dateFilter.gte, lt: dateFilter.lt } } : {}

  const [vekaletUcreti, odemelerAgg, avansAgg, masrafAgg, duzeltmeRows] = await Promise.all([
    dateFilter
      ? null
      : prisma.vekaletUcreti.findFirst({
          where: { tenantId, dosyaId, durum: 'AKTIF' },
          select: { toplamTutar: true }
        }),
    prisma.vekaletTaksitOdeme.aggregate({
      where: { tenantId, dosyaId, iptalAt: null, ...odemeDateWhere },
      _sum: { tutar: true }
    }),
    prisma.kasaHareketi.aggregate({
      where: { tenantId, dosyaId, tip: KasaHareketTipi.AVANS_GIRISI, onayDurumu: KasaOnayDurumu.ONAYLI, deletedAt: null, ...kasaDateWhere },
      _sum: { tutar: true }
    }),
    prisma.kasaHareketi.aggregate({
      where: { tenantId, dosyaId, tip: KasaHareketTipi.MASRAF, onayDurumu: KasaOnayDurumu.ONAYLI, deletedAt: null, ...kasaDateWhere },
      _sum: { tutar: true }
    }),
    prisma.kasaHareketi.findMany({
      where: { tenantId, dosyaId, tip: KasaHareketTipi.DUZELTME, onayDurumu: KasaOnayDurumu.ONAYLI, deletedAt: null, ...kasaDateWhere },
      select: { tutar: true }
    })
  ])

  const kararlastirilan = dateFilter ? 0 : Number(vekaletUcreti?.toplamTutar ?? 0)
  const tahsilEdilen = Number(odemelerAgg._sum.tutar ?? 0)
  const kalan = Math.max(0, kararlastirilan - tahsilEdilen)
  const tahsilatOrani = kararlastirilan > 0 ? Math.round((tahsilEdilen / kararlastirilan) * 10000) / 100 : 0

  const avans = Number(avansAgg._sum.tutar ?? 0)
  const masraf = Number(masrafAgg._sum.tutar ?? 0)

  let duzeltmeTotal = 0
  let masrafAvansiIadesi = 0
  for (const r of duzeltmeRows) {
    const v = Number(r.tutar)
    duzeltmeTotal += v
    if (v < 0) masrafAvansiIadesi += Math.abs(v)
  }

  const kasaBakiye = avans - masraf + duzeltmeTotal
  const buroKarsiladi = kasaBakiye < 0 ? Math.abs(kasaBakiye) : 0
  const netKazanc = tahsilEdilen - buroKarsiladi

  const f = (n: number) => n.toFixed(2)
  return {
    kararlastirilanVekalet: f(kararlastirilan),
    tahsilEdilenVekalet: f(tahsilEdilen),
    kalanVekalet: f(kalan),
    tahsilatOrani,
    alinanMasrafAvansi: f(avans),
    toplamMasraf: f(masraf),
    duzeltmeEtkisi: f(duzeltmeTotal),
    masrafAvansiIadesi: f(masrafAvansiIadesi),
    kalanMasrafAvansi: f(Math.max(0, kasaBakiye)),
    buroKarsiladigiGider: f(buroKarsiladi),
    netKazanc: f(netKazanc)
  }
}

function periodDates(period: { bas: string; bit: string }): { gte: Date; lt: Date } {
  const gte = new Date(`${period.bas}T00:00:00+03:00`)
  const bitNext = new Date(`${period.bit}T00:00:00+03:00`)
  bitNext.setDate(bitNext.getDate() + 1)
  return { gte, lt: bitNext }
}

export async function getDosyaMaliOzet(
  tenantId: string,
  dosyaId: string
): Promise<DosyaMaliOzetResponse | null> {
  const dosya = await prisma.dosya.findFirst({
    where: { id: dosyaId, tenantId },
    select: { id: true }
  })
  if (!dosya) return null

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { hesapDonemiModu: true }
  })
  const mode = tenant.hesapDonemiModu as AccountingPeriodMode
  const period = getAccountingPeriod(mode, toLocalYmd())
  const dates = periodDates(period)

  const [tumZamanlar, buDonem] = await Promise.all([
    computeForDosya(tenantId, dosyaId),
    computeForDosya(tenantId, dosyaId, dates)
  ])

  return {
    tumZamanlar,
    buDonem,
    donemEtiketi: period.etiket
  }
}

export type MuvekkilKarlilikDosya = {
  dosyaId: string
  konuBasligi: string
  dosyaNo: string | null
  durum: string
  paraBirimi: KarlilikCurrency
  tahsilEdilenVekalet: string
  buroKarsiladigiGider: string
  netKazanc: string
}

export type MuvekkilKarlilikDagilim = {
  enYuksekKazanc: MuvekkilKarlilikDosya | null
  enDusukKazanc: MuvekkilKarlilikDosya | null
}

export type MuvekkilKarlilikPayload = {
  toplamDosya: number
  kararlastirilanVekalet: MoneyByCurrency
  tahsilEdilenVekalet: MoneyByCurrency
  kalanAlacak: MoneyByCurrency
  /** Dosya kasası avans bakiyesi — yalnızca TRY. */
  toplamAvansBakiye: string
  /** Dosya kasası masraf toplamı — yalnızca TRY. */
  toplamDosyaMasrafi: string
  toplamMasrafAvansiIadesi: string
  /** Ofis Kasası manuel onaylı gelir (kaynakTipi’siz) + DUZELTME neti. */
  ofisGeliri: MoneyByCurrency
  /**
   * Net kazanç para birimine göre bağımsız:
   * gelir (vekalet tahsilatı alacak PB + ofis manuel) − gider (büro karşıladığı, şu an TRY).
   */
  netKazanc: MoneyByCurrency
  /** Para birimleri birbirleriyle kıyaslanmaz. */
  kazancDagilimi: Record<KarlilikCurrency, MuvekkilKarlilikDagilim | null>
}

export type MuvekkilKarlilikResponse = {
  tumZamanlar: MuvekkilKarlilikPayload
  buDonem: MuvekkilKarlilikPayload | null
  donemEtiketi: string | null
}

async function loadManuelOfisGelirBuckets(
  tenantId: string,
  muvekkilId: string,
  dateFilter?: { gte: Date; lt: Date }
): Promise<DecimalByCurrency> {
  const tarihWhere = dateFilter ? { tarih: { gte: dateFilter.gte, lt: dateFilter.lt } } : {}
  const gelirRows = await prisma.ofisKasaHareketi.findMany({
    where: {
      tenantId,
      muvekkilId,
      islemTipi: OfisKasaIslemTipi.GELIR,
      onayDurumu: OfisKasaOnayDurumu.ONAYLI,
      deletedAt: null,
      ...manuelOfisGelirKaynakWhere(),
      ...tarihWhere
    },
    select: { id: true, tutar: true, paraBirimi: true }
  })
  const gelirIds = gelirRows.map((r) => r.id)
  const duzeltmeRows =
    gelirIds.length === 0
      ? []
      : await prisma.ofisKasaHareketi.findMany({
          where: {
            tenantId,
            islemTipi: OfisKasaIslemTipi.DUZELTME,
            onayDurumu: OfisKasaOnayDurumu.ONAYLI,
            deletedAt: null,
            orijinalHareketId: { in: gelirIds },
            ...tarihWhere
          },
          select: { tutar: true, paraBirimi: true }
        })
  return sumKarlilikOfisGelirBuckets(
    gelirRows.map((r) => ({ tutar: r.tutar, paraBirimi: r.paraBirimi })),
    duzeltmeRows.map((r) => ({ tutar: r.tutar, paraBirimi: r.paraBirimi }))
  )
}

function pickDagilim(
  rows: MuvekkilKarlilikDosya[]
): MuvekkilKarlilikDagilim | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) =>
    new Prisma.Decimal(b.netKazanc).comparedTo(new Prisma.Decimal(a.netKazanc))
  )
  return {
    enYuksekKazanc: sorted[0] ?? null,
    enDusukKazanc: sorted.length > 1 ? sorted[sorted.length - 1]! : null
  }
}

async function computeForMuvekkil(
  tenantId: string,
  muvekkilId: string,
  dateFilter?: { gte: Date; lt: Date }
): Promise<MuvekkilKarlilikPayload> {
  const dosyalar = await prisma.dosya.findMany({
    where: { tenantId, muvekkilId },
    select: { id: true, konuBasligi: true, dosyaNo: true, durum: true }
  })

  const dosyaIds = dosyalar.map((d) => d.id)
  const kasaDateWhere = dateFilter ? { tarih: { gte: dateFilter.gte, lt: dateFilter.lt } } : {}
  const odemeDateWhere = dateFilter ? { odemeTarihi: { gte: dateFilter.gte, lt: dateFilter.lt } } : {}

  const [vekaletler, odemeler, kasaRows, ofisGelir] = await Promise.all([
    dateFilter || dosyaIds.length === 0
      ? Promise.resolve(
          [] as { dosyaId: string; toplamTutar: Prisma.Decimal; paraBirimi: string }[]
        )
      : prisma.vekaletUcreti.findMany({
          where: { tenantId, dosyaId: { in: dosyaIds }, durum: 'AKTIF' },
          select: { dosyaId: true, toplamTutar: true, paraBirimi: true }
        }),
    dosyaIds.length === 0
      ? Promise.resolve(
          [] as {
            dosyaId: string
            tutar: Prisma.Decimal
            alacakParaBirimi: string
          }[]
        )
      : prisma.vekaletTaksitOdeme.findMany({
          where: { tenantId, dosyaId: { in: dosyaIds }, iptalAt: null, ...odemeDateWhere },
          select: { dosyaId: true, tutar: true, alacakParaBirimi: true }
        }),
    dosyaIds.length === 0
      ? Promise.resolve([] as { dosyaId: string; tip: string; tutar: Prisma.Decimal }[])
      : prisma.kasaHareketi.findMany({
          where: {
            tenantId,
            dosyaId: { in: dosyaIds },
            onayDurumu: KasaOnayDurumu.ONAYLI,
            deletedAt: null,
            ...kasaDateWhere
          },
          select: { dosyaId: true, tip: true, tutar: true }
        }),
    loadManuelOfisGelirBuckets(tenantId, muvekkilId, dateFilter)
  ])

  const vekaletMap = new Map<string, { tutar: Prisma.Decimal; paraBirimi: KarlilikCurrency }>()
  for (const v of vekaletler) {
    const pb = resolveKarlilikCurrency(v.paraBirimi) ?? 'TRY'
    vekaletMap.set(v.dosyaId, { tutar: v.toplamTutar, paraBirimi: pb })
  }

  /** dosyaId → currency → tahsil (alacak PB / tutar — mevcut kanonik). */
  const odemeByDosya = new Map<string, DecimalByCurrency>()
  for (const o of odemeler) {
    let bucket = odemeByDosya.get(o.dosyaId)
    if (!bucket) {
      bucket = emptyDecimalByCurrency()
      odemeByDosya.set(o.dosyaId, bucket)
    }
    addToDecimalByCurrency(bucket, o.alacakParaBirimi, o.tutar)
  }

  const avansMap = new Map<string, Prisma.Decimal>()
  const masrafMap = new Map<string, Prisma.Decimal>()
  const duzeltmeMap = new Map<string, Prisma.Decimal>()
  const iadeMap = new Map<string, Prisma.Decimal>()
  for (const r of kasaRows) {
    if (r.tip === 'AVANS_GIRISI') {
      avansMap.set(r.dosyaId, (avansMap.get(r.dosyaId) ?? zeroDecimal()).plus(r.tutar))
    } else if (r.tip === 'MASRAF') {
      masrafMap.set(r.dosyaId, (masrafMap.get(r.dosyaId) ?? zeroDecimal()).plus(r.tutar))
    } else if (r.tip === 'DUZELTME') {
      duzeltmeMap.set(r.dosyaId, (duzeltmeMap.get(r.dosyaId) ?? zeroDecimal()).plus(r.tutar))
      if (r.tutar.isNegative()) {
        iadeMap.set(r.dosyaId, (iadeMap.get(r.dosyaId) ?? zeroDecimal()).plus(r.tutar.abs()))
      }
    }
  }

  const totalKarar = emptyDecimalByCurrency()
  const totalTahsil = emptyDecimalByCurrency()
  const totalGelir = emptyDecimalByCurrency()
  const totalGider = emptyDecimalByCurrency()
  let totalAvansBakiye = zeroDecimal()
  let totalMasraf = zeroDecimal()
  let totalIade = zeroDecimal()

  const dagilimRows: Record<KarlilikCurrency, MuvekkilKarlilikDosya[]> = {
    TRY: [],
    USD: [],
    EUR: []
  }

  for (const d of dosyalar) {
    const vekalet = vekaletMap.get(d.id)
    if (vekalet) addToDecimalByCurrency(totalKarar, vekalet.paraBirimi, vekalet.tutar)

    const tahsilBucket = odemeByDosya.get(d.id) ?? emptyDecimalByCurrency()
    for (const c of KARLILIK_CURRENCIES) {
      totalTahsil[c] = totalTahsil[c].plus(tahsilBucket[c])
      totalGelir[c] = totalGelir[c].plus(tahsilBucket[c])
    }

    const avans = avansMap.get(d.id) ?? zeroDecimal()
    const masraf = masrafMap.get(d.id) ?? zeroDecimal()
    const duzeltme = duzeltmeMap.get(d.id) ?? zeroDecimal()
    const iade = iadeMap.get(d.id) ?? zeroDecimal()
    const kasaBakiye = avans.minus(masraf).plus(duzeltme)
    const buroKarsiladi = kasaBakiye.isNegative() ? kasaBakiye.abs() : zeroDecimal()
    totalAvansBakiye = totalAvansBakiye.plus(kasaBakiye.isNegative() ? zeroDecimal() : kasaBakiye)
    totalMasraf = totalMasraf.plus(masraf)
    totalIade = totalIade.plus(iade)
    // Dosya kasası gider etkisi yalnız TRY (şema para birimi yok).
    totalGider.TRY = totalGider.TRY.plus(buroKarsiladi)

    for (const c of KARLILIK_CURRENCIES) {
      const tahsilC = tahsilBucket[c]
      const buroC = c === 'TRY' ? buroKarsiladi : zeroDecimal()
      const netC = tahsilC.minus(buroC)
      const hasActivity =
        isNonZeroDecimal(tahsilC) ||
        isNonZeroDecimal(buroC) ||
        (vekalet?.paraBirimi === c && isNonZeroDecimal(vekalet.tutar))
      if (!hasActivity) continue
      dagilimRows[c].push({
        dosyaId: d.id,
        konuBasligi: d.konuBasligi,
        dosyaNo: d.dosyaNo,
        durum: d.durum,
        paraBirimi: c,
        tahsilEdilenVekalet: moneyToApiString(tahsilC),
        buroKarsiladigiGider: moneyToApiString(buroC),
        netKazanc: moneyToApiString(netC)
      })
    }
  }

  for (const c of KARLILIK_CURRENCIES) {
    totalGelir[c] = totalGelir[c].plus(ofisGelir[c])
  }

  const net = netByCurrency(totalGelir, totalGider)
  const kalan = emptyDecimalByCurrency()
  for (const c of KARLILIK_CURRENCIES) {
    const k = totalKarar[c].minus(totalTahsil[c])
    kalan[c] = k.isNegative() ? zeroDecimal() : k
  }

  return {
    toplamDosya: dosyalar.length,
    kararlastirilanVekalet: toMoneyByCurrency(totalKarar),
    tahsilEdilenVekalet: toMoneyByCurrency(totalTahsil),
    kalanAlacak: toMoneyByCurrency(kalan),
    toplamAvansBakiye: moneyToApiString(totalAvansBakiye),
    toplamDosyaMasrafi: moneyToApiString(totalMasraf),
    toplamMasrafAvansiIadesi: moneyToApiString(totalIade),
    ofisGeliri: toMoneyByCurrency(ofisGelir),
    netKazanc: toMoneyByCurrency(net),
    kazancDagilimi: {
      TRY: pickDagilim(dagilimRows.TRY),
      USD: pickDagilim(dagilimRows.USD),
      EUR: pickDagilim(dagilimRows.EUR)
    }
  }
}

export async function getMuvekkilKarlilik(
  tenantId: string,
  muvekkilId: string
): Promise<MuvekkilKarlilikResponse | null> {
  const muvekkil = await prisma.muvekkil.findFirst({
    where: { id: muvekkilId, tenantId },
    select: { id: true }
  })
  if (!muvekkil) return null

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { hesapDonemiModu: true }
  })
  const mode = tenant.hesapDonemiModu as AccountingPeriodMode
  const period = getAccountingPeriod(mode, toLocalYmd())
  const dates = periodDates(period)

  const [tumZamanlar, buDonem] = await Promise.all([
    computeForMuvekkil(tenantId, muvekkilId),
    computeForMuvekkil(tenantId, muvekkilId, dates)
  ])

  return {
    tumZamanlar,
    buDonem,
    donemEtiketi: period.etiket
  }
}
