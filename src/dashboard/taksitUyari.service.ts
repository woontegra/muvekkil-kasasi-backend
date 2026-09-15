/**
 * Taksit uyarıları — aktif tahsilat ödemeleri (iptal / ofis soft-delete hariç).
 */
import { Prisma, VekaletTaksitOdemeDurumu } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { moneyToApiString } from '../lib/paraBirimi.js'
import { filterAktifTahsilatOdemeleri } from '../lib/tahsilatOdemeAktif.js'
import { computeTaksitOdemeOzeti } from '../vekalet/taksitOdemeOzet.js'
import { smmBekleyenWhere } from '../smm/smm.service.js'

export type TaksitUyariSinif = 'vadesiGecmis' | 'bugunOdenecek' | 'odenmemis'

export type TaksitUyariListeSatir = {
  id: string
  kaynak: 'VEKALET' | 'ICRA'
  muvekkilId: string | null
  dosyaId: string | null
  muvekkilAd: string
  dosyaBaslik: string
  taksitNo: number
  taksitEtiket: string
  vadeTarihi: string
  tutar: string
  odenen: string
  kalan: string
  paraBirimi: string
  durum: 'GECIKTI'
}

export type TaksitUyarilariPayload = {
  vadesiGecmisCount: number
  bugunOdenecekCount: number
  odenmemisCount: number
  smmBekleyenCount: number
  vadesiGecmisListe: TaksitUyariListeSatir[]
}

const odemeAktiflikSelect = {
  id: true,
  tutar: true,
  iptalAt: true,
  ofisKasaHareketId: true,
  ofisKasaHareket: { select: { deletedAt: true } }
} as const

function bugunYmdLocal(ref = new Date()): string {
  const y = ref.getFullYear()
  const m = String(ref.getMonth() + 1).padStart(2, '0')
  const d = String(ref.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function vadeToYmdLocal(vade: Date): string {
  return bugunYmdLocal(vade)
}

/** kalan > 0 ise vade tarihine göre sınıflandırır (Decimal). */
export function siniflaTaksitUyari(
  vadeTarihi: Date,
  kalanTutar: Prisma.Decimal | string | number,
  bugun = bugunYmdLocal()
): TaksitUyariSinif | null {
  const kalan = new Prisma.Decimal(kalanTutar)
  if (kalan.lte(0)) return null
  const v = vadeToYmdLocal(vadeTarihi)
  if (v < bugun) return 'vadesiGecmis'
  if (v === bugun) return 'bugunOdenecek'
  return 'odenmemis'
}

async function countSmmBekleyen(tenantId: string): Promise<number> {
  const [vekalet, icra] = await Promise.all([
    prisma.vekaletTaksitOdeme.count({ where: smmBekleyenWhere(tenantId) }),
    prisma.icraTahsilatOdeme.count({
      where: {
        tenantId,
        smmKesildiMi: false,
        // icra ödemelerinde iptal alanı yoksa yalnız smm flag
      }
    })
  ])
  return vekalet + icra
}

/** Kiracı taksit uyarı özeti — vekalet + icra; yalnız aktif ödemeler. */
export async function getTaksitUyarilariForTenant(tenantId: string): Promise<TaksitUyarilariPayload> {
  const bugun = bugunYmdLocal()

  const [vekaletRows, icraRows, smmBekleyenCount] = await Promise.all([
    prisma.vekaletTaksiti.findMany({
      where: {
        tenantId,
        odemeDurumu: { not: VekaletTaksitOdemeDurumu.IPTAL }
      },
      include: {
        odemeler: { select: odemeAktiflikSelect },
        muvekkil: { select: { gorunenAd: true } },
        dosya: { select: { konuBasligi: true } }
      }
    }),
    prisma.icraTahsilatTaksit.findMany({
      where: {
        tenantId,
        alacak: { durum: { not: 'IPTAL' } }
      },
      include: {
        odemeler: { select: { id: true, tutar: true } },
        alacak: {
          include: {
            muvekkil: { select: { gorunenAd: true } },
            dosya: { select: { konuBasligi: true } }
          }
        }
      }
    }),
    countSmmBekleyen(tenantId)
  ])

  let vadesiGecmisCount = 0
  let bugunOdenecekCount = 0
  let odenmemisCount = 0
  const vadesiGecmisListe: TaksitUyariListeSatir[] = []

  for (const t of vekaletRows) {
    const ozet = computeTaksitOdemeOzeti(t.tutar, t.odemeler)
    const sinif = siniflaTaksitUyari(t.vadeTarihi, ozet.kalanTutar, bugun)
    if (sinif === 'vadesiGecmis') {
      vadesiGecmisCount += 1
      vadesiGecmisListe.push({
        id: t.id,
        kaynak: 'VEKALET',
        muvekkilId: t.muvekkilId,
        dosyaId: t.dosyaId,
        muvekkilAd: t.muvekkil.gorunenAd,
        dosyaBaslik: t.dosya.konuBasligi,
        taksitNo: t.taksitNo,
        taksitEtiket: String(t.taksitNo),
        vadeTarihi: vadeToYmdLocal(t.vadeTarihi),
        tutar: ozet.taksitTutariStr,
        odenen: ozet.odenenToplamStr,
        kalan: ozet.kalanTutarStr,
        paraBirimi: t.paraBirimi,
        durum: 'GECIKTI'
      })
    } else if (sinif === 'bugunOdenecek') {
      bugunOdenecekCount += 1
    } else if (sinif === 'odenmemis') {
      odenmemisCount += 1
    }
  }

  for (const t of icraRows) {
    // İcra ödemelerinde ofis soft-delete modeli yok; tutarları Decimal topla.
    let odenen = new Prisma.Decimal(0)
    for (const o of t.odemeler) odenen = odenen.plus(o.tutar)
    const kalanRaw = t.tutar.minus(odenen)
    const kalan = kalanRaw.isNegative() ? new Prisma.Decimal(0) : kalanRaw
    const sinif = siniflaTaksitUyari(t.vadeTarihi, kalan, bugun)
    const alacak = t.alacak
    const muvekkilAd = alacak.muvekkil?.gorunenAd ?? alacak.borcluAd
    const dosyaBaslik = alacak.dosya?.konuBasligi ?? `İcra — ${alacak.borcluAd}`
    if (sinif === 'vadesiGecmis') {
      vadesiGecmisCount += 1
      vadesiGecmisListe.push({
        id: t.id,
        kaynak: 'ICRA',
        muvekkilId: alacak.muvekkilId,
        dosyaId: alacak.dosyaId,
        muvekkilAd,
        dosyaBaslik,
        taksitNo: t.taksitNo,
        taksitEtiket: String(t.taksitNo),
        vadeTarihi: vadeToYmdLocal(t.vadeTarihi),
        tutar: moneyToApiString(t.tutar),
        odenen: moneyToApiString(odenen),
        kalan: moneyToApiString(kalan),
        paraBirimi: t.paraBirimi,
        durum: 'GECIKTI'
      })
    } else if (sinif === 'bugunOdenecek') {
      bugunOdenecekCount += 1
    } else if (sinif === 'odenmemis') {
      odenmemisCount += 1
    }
  }

  vadesiGecmisListe.sort((a, b) => {
    if (a.vadeTarihi !== b.vadeTarihi) return a.vadeTarihi.localeCompare(b.vadeTarihi)
    if (a.muvekkilAd !== b.muvekkilAd) return a.muvekkilAd.localeCompare(b.muvekkilAd, 'tr')
    return a.taksitNo - b.taksitNo
  })

  return {
    vadesiGecmisCount,
    bugunOdenecekCount,
    odenmemisCount,
    smmBekleyenCount,
    vadesiGecmisListe
  }
}

/** Test yardımcısı — yalnız aktif ödemeleri toplar. */
export function sumAktifOdemeForUyari(
  odemeler: Parameters<typeof filterAktifTahsilatOdemeleri>[0]
): Prisma.Decimal {
  let s = new Prisma.Decimal(0)
  for (const o of filterAktifTahsilatOdemeleri(odemeler)) {
    s = s.plus((o as { tutar: Prisma.Decimal }).tutar)
  }
  return s
}
