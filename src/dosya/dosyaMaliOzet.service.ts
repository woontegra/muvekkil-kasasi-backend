import { KasaHareketTipi, KasaOnayDurumu } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import {
  type AccountingPeriodMode,
  getAccountingPeriod,
  toLocalYmd
} from '../lib/accountingPeriod.js'

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
      : prisma.vekaletUcreti.findUnique({
          where: { dosyaId },
          select: { toplamTutar: true }
        }),
    prisma.vekaletTaksitOdeme.aggregate({
      where: { tenantId, dosyaId, ...odemeDateWhere },
      _sum: { tutar: true }
    }),
    prisma.kasaHareketi.aggregate({
      where: { tenantId, dosyaId, tip: KasaHareketTipi.AVANS_GIRISI, onayDurumu: KasaOnayDurumu.ONAYLI, ...kasaDateWhere },
      _sum: { tutar: true }
    }),
    prisma.kasaHareketi.aggregate({
      where: { tenantId, dosyaId, tip: KasaHareketTipi.MASRAF, onayDurumu: KasaOnayDurumu.ONAYLI, ...kasaDateWhere },
      _sum: { tutar: true }
    }),
    prisma.kasaHareketi.findMany({
      where: { tenantId, dosyaId, tip: KasaHareketTipi.DUZELTME, onayDurumu: KasaOnayDurumu.ONAYLI, ...kasaDateWhere },
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
  tahsilEdilenVekalet: number
  buroKarsiladigiGider: number
  netKazanc: number
}

export type MuvekkilKarlilikPayload = {
  toplamDosya: number
  kararlastirilanVekalet: string
  tahsilEdilenVekalet: string
  kalanAlacak: string
  toplamAvansBakiye: string
  toplamDosyaMasrafi: string
  toplamMasrafAvansiIadesi: string
  netKazanc: string
  enYuksekKazanc: MuvekkilKarlilikDosya | null
  enDusukKazanc: MuvekkilKarlilikDosya | null
}

export type MuvekkilKarlilikResponse = {
  tumZamanlar: MuvekkilKarlilikPayload
  buDonem: MuvekkilKarlilikPayload | null
  donemEtiketi: string | null
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
  if (dosyalar.length === 0) {
    const z = '0.00'
    return {
      toplamDosya: 0,
      kararlastirilanVekalet: z, tahsilEdilenVekalet: z, kalanAlacak: z,
      toplamAvansBakiye: z, toplamDosyaMasrafi: z, toplamMasrafAvansiIadesi: z, netKazanc: z,
      enYuksekKazanc: null, enDusukKazanc: null
    }
  }

  const dosyaIds = dosyalar.map(d => d.id)
  const kasaDateWhere = dateFilter ? { tarih: { gte: dateFilter.gte, lt: dateFilter.lt } } : {}
  const odemeDateWhere = dateFilter ? { odemeTarihi: { gte: dateFilter.gte, lt: dateFilter.lt } } : {}

  const [vekaletler, odemeler, kasaRows] = await Promise.all([
    dateFilter
      ? Promise.resolve([])
      : prisma.vekaletUcreti.findMany({
          where: { tenantId, dosyaId: { in: dosyaIds } },
          select: { dosyaId: true, toplamTutar: true }
        }),
    prisma.vekaletTaksitOdeme.findMany({
      where: { tenantId, dosyaId: { in: dosyaIds }, ...odemeDateWhere },
      select: { dosyaId: true, tutar: true }
    }),
    prisma.kasaHareketi.findMany({
      where: { tenantId, dosyaId: { in: dosyaIds }, onayDurumu: KasaOnayDurumu.ONAYLI, ...kasaDateWhere },
      select: { dosyaId: true, tip: true, tutar: true }
    })
  ])

  const vekaletMap = new Map<string, number>()
  for (const v of vekaletler) vekaletMap.set(v.dosyaId, Number(v.toplamTutar))

  const odemeMap = new Map<string, number>()
  for (const o of odemeler) odemeMap.set(o.dosyaId, (odemeMap.get(o.dosyaId) ?? 0) + Number(o.tutar))

  const avansMap = new Map<string, number>()
  const masrafMap = new Map<string, number>()
  const duzeltmeMap = new Map<string, number>()
  const iadeMap = new Map<string, number>()
  for (const r of kasaRows) {
    const v = Number(r.tutar)
    if (r.tip === 'AVANS_GIRISI') avansMap.set(r.dosyaId, (avansMap.get(r.dosyaId) ?? 0) + v)
    else if (r.tip === 'MASRAF') masrafMap.set(r.dosyaId, (masrafMap.get(r.dosyaId) ?? 0) + v)
    else if (r.tip === 'DUZELTME') {
      duzeltmeMap.set(r.dosyaId, (duzeltmeMap.get(r.dosyaId) ?? 0) + v)
      if (v < 0) iadeMap.set(r.dosyaId, (iadeMap.get(r.dosyaId) ?? 0) + Math.abs(v))
    }
  }

  let totalKararlastirilan = 0, totalTahsil = 0, totalAvansBakiye = 0, totalMasraf = 0, totalNetKazanc = 0, totalIade = 0
  const dosyaKazanclari: MuvekkilKarlilikDosya[] = []

  for (const d of dosyalar) {
    const kararlastirilan = vekaletMap.get(d.id) ?? 0
    const tahsil = odemeMap.get(d.id) ?? 0
    const avans = avansMap.get(d.id) ?? 0
    const masraf = masrafMap.get(d.id) ?? 0
    const duzeltme = duzeltmeMap.get(d.id) ?? 0
    const iade = iadeMap.get(d.id) ?? 0
    const kasaBakiye = avans - masraf + duzeltme
    const buroKarsiladi = kasaBakiye < 0 ? Math.abs(kasaBakiye) : 0
    const net = tahsil - buroKarsiladi

    totalKararlastirilan += kararlastirilan
    totalTahsil += tahsil
    totalAvansBakiye += Math.max(0, kasaBakiye)
    totalMasraf += masraf
    totalIade += iade
    totalNetKazanc += net

    dosyaKazanclari.push({
      dosyaId: d.id,
      konuBasligi: d.konuBasligi,
      dosyaNo: d.dosyaNo,
      durum: d.durum,
      tahsilEdilenVekalet: tahsil,
      buroKarsiladigiGider: buroKarsiladi,
      netKazanc: net
    })
  }

  dosyaKazanclari.sort((a, b) => b.netKazanc - a.netKazanc)
  const enYuksek = dosyaKazanclari.length > 0 ? dosyaKazanclari[0] : null
  const enDusuk = dosyaKazanclari.length > 1 ? dosyaKazanclari[dosyaKazanclari.length - 1] : null

  const f = (n: number) => n.toFixed(2)
  return {
    toplamDosya: dosyalar.length,
    kararlastirilanVekalet: f(totalKararlastirilan),
    tahsilEdilenVekalet: f(totalTahsil),
    kalanAlacak: f(Math.max(0, totalKararlastirilan - totalTahsil)),
    toplamAvansBakiye: f(totalAvansBakiye),
    toplamDosyaMasrafi: f(totalMasraf),
    toplamMasrafAvansiIadesi: f(totalIade),
    netKazanc: f(totalNetKazanc),
    enYuksekKazanc: enYuksek,
    enDusukKazanc: enDusuk
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
