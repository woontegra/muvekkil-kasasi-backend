import { VekaletTaksitOdemeDurumu } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

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
  durum: 'GECIKTI'
}

export type TaksitUyarilariPayload = {
  vadesiGecmisCount: number
  bugunOdenecekCount: number
  odenmemisCount: number
  smmBekleyenCount: number
  vadesiGecmisListe: TaksitUyariListeSatir[]
}

function bugunYmdLocal(ref = new Date()): string {
  const y = ref.getFullYear()
  const m = String(ref.getMonth() + 1).padStart(2, '0')
  const d = String(ref.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function vadeToYmdLocal(vade: Date): string {
  return bugunYmdLocal(vade)
}

function sumOdeme(tutarlar: { tutar: { toString: () => string } }[]): number {
  return tutarlar.reduce((s, o) => s + Number(o.tutar), 0)
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

/** kalan > 0 ise vade tarihine göre sınıflandırır. */
export function siniflaTaksitUyari(
  vadeTarihi: Date,
  kalanTutar: number,
  bugun = bugunYmdLocal()
): TaksitUyariSinif | null {
  if (!Number.isFinite(kalanTutar) || kalanTutar <= 0.001) return null
  const v = vadeToYmdLocal(vadeTarihi)
  if (v < bugun) return 'vadesiGecmis'
  if (v === bugun) return 'bugunOdenecek'
  return 'odenmemis'
}

async function countSmmBekleyen(tenantId: string): Promise<number> {
  const [vekalet, icra] = await Promise.all([
    prisma.vekaletTaksitOdeme.count({ where: { tenantId, smmKesildiMi: false } }),
    prisma.icraTahsilatOdeme.count({ where: { tenantId, smmKesildiMi: false } })
  ])
  return vekalet + icra
}

/** Kiracı taksit uyarı özeti — vekalet + icra taksitleri, ödeme toplamına göre kalan. */
export async function getTaksitUyarilariForTenant(tenantId: string): Promise<TaksitUyarilariPayload> {
  const bugun = bugunYmdLocal()

  const [vekaletRows, icraRows, smmBekleyenCount] = await Promise.all([
    prisma.vekaletTaksiti.findMany({
      where: {
        tenantId,
        odemeDurumu: { not: VekaletTaksitOdemeDurumu.IPTAL }
      },
      include: {
        odemeler: { select: { tutar: true } },
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
        odemeler: { select: { tutar: true } },
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
    const tutar = Number(t.tutar)
    const odenen = sumOdeme(t.odemeler)
    const kalan = Math.max(0, tutar - odenen)
    const sinif = siniflaTaksitUyari(t.vadeTarihi, kalan, bugun)
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
        tutar: fmt(tutar),
        odenen: fmt(odenen),
        kalan: fmt(kalan),
        durum: 'GECIKTI'
      })
    } else if (sinif === 'bugunOdenecek') {
      bugunOdenecekCount += 1
    } else if (sinif === 'odenmemis') {
      odenmemisCount += 1
    }
  }

  for (const t of icraRows) {
    const tutar = Number(t.tutar)
    const odenen = sumOdeme(t.odemeler)
    const kalan = Math.max(0, tutar - odenen)
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
        tutar: fmt(tutar),
        odenen: fmt(odenen),
        kalan: fmt(kalan),
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
