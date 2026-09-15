import {
  DosyaDurumu,
  KasaHareketTipi,
  KasaOnayDurumu,
  ParaBirimi,
  Prisma,
  VekaletTaksitOdemeDurumu
} from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { formatMoneyDisplay } from '../lib/paraBirimi.js'
import { aktifTahsilatOdemeWhere, isTahsilatOdemeAktif } from '../lib/tahsilatOdemeAktif.js'
import { computeTaksitOdemeOzeti } from '../vekalet/taksitOdemeOzet.js'

export { aktifTahsilatOdemeWhere }

export type UyariSeviyesi = 'KRITIK' | 'UYARI' | 'BILGI'

export type UyariTuru =
  | 'VADESI_GECMIS_TAKSIT'
  | 'KISMI_ODEME_KALAN'
  | 'VAKLAŞAN_VADE'
  | 'NEGATIF_AVANS'
  | 'KAPALI_DOSYA_AVANS'
  | 'KAPALI_DOSYA_ALACAK'
  | 'SMM_KESILMEMIS'
  | 'ONAY_BEKLEYEN_KASA'
  | 'MAKBUZ_EKSIK'
  | 'HAREKETSIZ_DOSYA'

export type MaliKontrolActionTarget =
  | 'VEKALET_TAKSIT'
  | 'DOSYA_VEKALET'
  | 'SMM_ODEME'
  | 'MAKBUZ_ODEME'
  | 'KASA_HAREKET'
  | 'DOSYA_MALI'
  | 'DOSYA_GENEL'

export type MaliKontrolActionPayload = {
  muvekkilId: string
  dosyaId: string
  tab: 'kasa' | 'vekalet' | 'smm' | 'makbuz' | 'hesap' | 'mali'
  taksitId?: string
  odemeId?: string
  kasaHareketiId?: string
  kasaFilter?: 'onaysiz'
}

export type MaliKontrolUyari = {
  id: string
  tur: UyariTuru
  seviye: UyariSeviyesi
  muvekkilId: string | null
  muvekkilAd: string
  dosyaId: string | null
  dosyaBaslik: string
  tutar: string | null
  tarih: string | null
  aciklama: string
  actionTarget: MaliKontrolActionTarget | null
  actionPayload: MaliKontrolActionPayload | null
}

export type MaliKontrolResponse = {
  toplamUyari: number
  kritikUyari: number
  uyariUyari: number
  bilgiUyari: number
  uyarilar: MaliKontrolUyari[]
}

function fmt(n: number): string {
  return n.toFixed(2)
}

function fmtTry(n: number): string {
  return formatMoneyDisplay(n.toFixed(2), ParaBirimi.TRY)
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const EPS = new Prisma.Decimal('0.001')

const odemeAktiflikSelect = {
  id: true,
  tutar: true,
  iptalAt: true,
  ofisKasaHareketId: true,
  ofisKasaHareket: { select: { deletedAt: true } }
} as const


function decimalToNum(d: Prisma.Decimal): number {
  return Number(d)
}

function sumKasaByTip(rows: { tip: KasaHareketTipi; tutar: Prisma.Decimal }[]): {
  avans: Prisma.Decimal
  masraf: Prisma.Decimal
  duzeltme: Prisma.Decimal
} {
  let avans = new Prisma.Decimal(0)
  let masraf = new Prisma.Decimal(0)
  let duzeltme = new Prisma.Decimal(0)
  for (const r of rows) {
    if (r.tip === KasaHareketTipi.AVANS_GIRISI) avans = avans.plus(r.tutar)
    else if (r.tip === KasaHareketTipi.MASRAF) masraf = masraf.plus(r.tutar)
    else if (r.tip === KasaHareketTipi.DUZELTME) duzeltme = duzeltme.plus(r.tutar)
  }
  return { avans, masraf, duzeltme }
}

export function kasaAvansBakiye(rows: { tip: KasaHareketTipi; tutar: Prisma.Decimal }[]): Prisma.Decimal {
  const { avans, masraf, duzeltme } = sumKasaByTip(rows)
  return avans.minus(masraf).plus(duzeltme)
}

function buildAction(
  muvekkilId: string,
  dosyaId: string,
  target: MaliKontrolActionTarget,
  tab: MaliKontrolActionPayload['tab'],
  extra?: Pick<MaliKontrolActionPayload, 'taksitId' | 'odemeId' | 'kasaHareketiId' | 'kasaFilter'>
): { actionTarget: MaliKontrolActionTarget; actionPayload: MaliKontrolActionPayload } {
  return {
    actionTarget: target,
    actionPayload: { muvekkilId, dosyaId, tab, ...extra }
  }
}

export async function getMaliKontrolUyarilari(tenantId: string): Promise<MaliKontrolResponse> {
  const bugunDate = new Date()
  const bugun = ymdLocal(bugunDate)

  // 3 gün sonrasının başlangıcı
  const ucGunSonra = new Date(bugunDate)
  ucGunSonra.setDate(ucGunSonra.getDate() + 3)

  // 90 gün öncesi — hareketsiz dosya eşiği
  const doksanGunOnce = new Date(bugunDate)
  doksanGunOnce.setDate(doksanGunOnce.getDate() - 90)

  const [vekaletTaksitler, kasaRows, kasaOnaysizRows, kapaliDosyalar, smmEksikOdemeler, makbuzEksikOdemeler] =
    await Promise.all([
      // Tüm iptal olmayan taksitler (ödeme durumu ne olursa olsun kontrol edeceğiz)
      prisma.vekaletTaksiti.findMany({
        where: {
          tenantId,
          odemeDurumu: { not: VekaletTaksitOdemeDurumu.IPTAL }
        },
        include: {
          odemeler: { select: odemeAktiflikSelect },
          muvekkil: { select: { id: true, gorunenAd: true } },
          dosya: { select: { id: true, konuBasligi: true, dosyaNo: true, durum: true } }
        }
      }),

      // Tüm onaylı kasa hareketleri (avans hesabı için)
      prisma.kasaHareketi.findMany({
        where: { tenantId, onayDurumu: KasaOnayDurumu.ONAYLI, deletedAt: null },
        select: {
          dosyaId: true,
          tip: true,
          tutar: true,
          dosya: { select: { id: true, konuBasligi: true, dosyaNo: true, durum: true } },
          muvekkil: { select: { id: true, gorunenAd: true } }
        }
      }),

      // Onay bekleyen kasa hareketleri
      prisma.kasaHareketi.findMany({
        where: { tenantId, onayDurumu: KasaOnayDurumu.ONAYSIZ, deletedAt: null },
        select: {
          id: true,
          tarih: true,
          tip: true,
          tutar: true,
          dosyaId: true,
          dosya: { select: { id: true, konuBasligi: true, dosyaNo: true } },
          muvekkil: { select: { id: true, gorunenAd: true } }
        }
      }),

      // Kapanmış dosyalar (KAPANDI veya ARSIV)
      prisma.dosya.findMany({
        where: {
          tenantId,
          durum: { in: [DosyaDurumu.KAPANDI, DosyaDurumu.ARSIV] }
        },
        select: {
          id: true,
          konuBasligi: true,
          dosyaNo: true,
          durum: true,
          muvekkilId: true,
          muvekkil: { select: { id: true, gorunenAd: true } },
          vekaletUcretleri: {
            where: { durum: 'AKTIF' },
            select: { toplamTutar: true },
            take: 1
          },
          kasaHareketleri: {
            where: { onayDurumu: KasaOnayDurumu.ONAYLI, deletedAt: null },
            select: { tip: true, tutar: true }
          },
          vekaletTaksitleri: {
            where: { odemeDurumu: { not: VekaletTaksitOdemeDurumu.IPTAL } },
            include: { odemeler: { select: odemeAktiflikSelect } }
          }
        }
      }),

      // SMM kesilmemiş vekalet taksit ödemeleri
      prisma.vekaletTaksitOdeme.findMany({
        where: { tenantId, smmKesildiMi: false, ...aktifTahsilatOdemeWhere() },
        select: {
          id: true,
          tutar: true,
          odemeTarihi: true,
          dosyaId: true,
          muvekkilId: true,
          iptalAt: true,
          ofisKasaHareketId: true,
          ofisKasaHareket: { select: { deletedAt: true } },
          dosya: { select: { id: true, konuBasligi: true, dosyaNo: true } },
          muvekkil: { select: { id: true, gorunenAd: true } }
        }
      }),

      // Makbuz numarası boş olan vekalet taksit ödemeleri
      prisma.vekaletTaksitOdeme.findMany({
        where: { tenantId, makbuzNo: '', ...aktifTahsilatOdemeWhere() },
        select: {
          id: true,
          tutar: true,
          odemeTarihi: true,
          dosyaId: true,
          muvekkilId: true,
          iptalAt: true,
          ofisKasaHareketId: true,
          ofisKasaHareket: { select: { deletedAt: true } },
          dosya: { select: { id: true, konuBasligi: true, dosyaNo: true } },
          muvekkil: { select: { id: true, gorunenAd: true } }
        }
      })
    ])

  const uyarilar: MaliKontrolUyari[] = []
  const seen = new Set<string>()

  function addUyari(u: MaliKontrolUyari) {
    const key = `${u.tur}:${u.id}`
    if (seen.has(key)) return
    seen.add(key)
    uyarilar.push(u)
  }

  // ── 1. Vadesi geçmiş taksitler (ODENMEDI veya KISMI_ODENDI, vade < bugün) ──
  for (const t of vekaletTaksitler) {
    const ozet = computeTaksitOdemeOzeti(t.tutar, t.odemeler)
    const kalan = ozet.kalanTutar
    if (!kalan.gt(EPS)) continue
    const kalanNum = decimalToNum(kalan)

    const vadeYmd = ymdLocal(t.vadeTarihi)
    const dosyaBaslik = t.dosya.konuBasligi + (t.dosya.dosyaNo ? ` (${t.dosya.dosyaNo})` : '')

    if (vadeYmd < bugun) {
      addUyari({
        id: t.id,
        tur: 'VADESI_GECMIS_TAKSIT',
        seviye: 'KRITIK',
        muvekkilId: t.muvekkilId,
        muvekkilAd: t.muvekkil.gorunenAd,
        dosyaId: t.dosyaId,
        dosyaBaslik,
        tutar: fmt(kalanNum),
        tarih: vadeYmd,
        aciklama: `Taksit ${t.taksitNo} vadesi geçmiş; kalan: ${fmtTry(kalanNum)}`,
        ...buildAction(t.muvekkilId, t.dosyaId, 'VEKALET_TAKSIT', 'vekalet', { taksitId: t.id })
      })
    } else if (vadeYmd <= ymdLocal(ucGunSonra)) {
      // ── 3. 3 gün içinde vadesi dolacak ──
      addUyari({
        id: t.id,
        tur: 'VAKLAŞAN_VADE',
        seviye: 'UYARI',
        muvekkilId: t.muvekkilId,
        muvekkilAd: t.muvekkil.gorunenAd,
        dosyaId: t.dosyaId,
        dosyaBaslik,
        tutar: fmt(kalanNum),
        tarih: vadeYmd,
        aciklama: `Taksit ${t.taksitNo} 3 gün içinde vadesi dolacak; kalan: ${fmtTry(kalanNum)}`,
        ...buildAction(t.muvekkilId, t.dosyaId, 'VEKALET_TAKSIT', 'vekalet', { taksitId: t.id })
      })
    } else if (t.odemeDurumu === VekaletTaksitOdemeDurumu.KISMI_ODENDI) {
      // ── 2. Kısmi ödeme yapılmış, bakiyesi kalan ──
      addUyari({
        id: t.id,
        tur: 'KISMI_ODEME_KALAN',
        seviye: 'BILGI',
        muvekkilId: t.muvekkilId,
        muvekkilAd: t.muvekkil.gorunenAd,
        dosyaId: t.dosyaId,
        dosyaBaslik,
        tutar: fmt(kalanNum),
        tarih: vadeYmd,
        aciklama: `Taksit ${t.taksitNo} kısmi ödenmiş; kalan: ${fmtTry(kalanNum)}`,
        ...buildAction(t.muvekkilId, t.dosyaId, 'VEKALET_TAKSIT', 'vekalet', { taksitId: t.id })
      })
    }
  }

  // ── 4 & 5. Avans bakiyesi hesabı (dosya bazlı) ──
  type AvansData = {
    avans: Prisma.Decimal
    masraf: Prisma.Decimal
    duzeltme: Prisma.Decimal
    dosyaId: string
    muvekkilId: string
    dosyaBaslik: string
    muvekkilAd: string
    durum: DosyaDurumu
  }
  const avansMap = new Map<string, AvansData>()

  for (const r of kasaRows) {
    if (!r.dosya || !r.muvekkil) continue
    const dosyaId = r.dosyaId
    let entry = avansMap.get(dosyaId)
    if (!entry) {
      const dosyaBaslik = r.dosya.konuBasligi + (r.dosya.dosyaNo ? ` (${r.dosya.dosyaNo})` : '')
      entry = {
        avans: new Prisma.Decimal(0),
        masraf: new Prisma.Decimal(0),
        duzeltme: new Prisma.Decimal(0),
        dosyaId,
        muvekkilId: r.muvekkil.id,
        dosyaBaslik,
        muvekkilAd: r.muvekkil.gorunenAd,
        durum: r.dosya.durum as DosyaDurumu
      }
      avansMap.set(dosyaId, entry)
    }
    if (r.tip === KasaHareketTipi.AVANS_GIRISI) entry.avans = entry.avans.plus(r.tutar)
    else if (r.tip === KasaHareketTipi.MASRAF) entry.masraf = entry.masraf.plus(r.tutar)
    else if (r.tip === KasaHareketTipi.DUZELTME) entry.duzeltme = entry.duzeltme.plus(r.tutar)
  }

  for (const [dosyaId, d] of avansMap) {
    const bakiye = d.avans.minus(d.masraf).plus(d.duzeltme)
    if (bakiye.lt(EPS.negated())) {
      const absBakiye = bakiye.abs()
      const absNum = decimalToNum(absBakiye)
      // ── 4. Negatif avans bakiyesi ──
      addUyari({
        id: `avans-neg-${dosyaId}`,
        tur: 'NEGATIF_AVANS',
        seviye: 'KRITIK',
        muvekkilId: d.muvekkilId,
        muvekkilAd: d.muvekkilAd,
        dosyaId,
        dosyaBaslik: d.dosyaBaslik,
        tutar: fmt(absNum),
        tarih: null,
        aciklama: `Masraf avansı negatife düştü; büro ${fmtTry(absNum)} karşılıyor`,
        ...buildAction(d.muvekkilId, dosyaId, 'DOSYA_MALI', 'mali')
      })
    }
  }

  // ── 6. Kapanmış dosyada kalan avans ──
  for (const d of kapaliDosyalar) {
    const bakiye = kasaAvansBakiye(d.kasaHareketleri)
    const dosyaBaslik = d.konuBasligi + (d.dosyaNo ? ` (${d.dosyaNo})` : '')

    if (bakiye.gt(EPS)) {
      const bakiyeNum = decimalToNum(bakiye)
      addUyari({
        id: `kapali-avans-${d.id}`,
        tur: 'KAPALI_DOSYA_AVANS',
        seviye: 'UYARI',
        muvekkilId: d.muvekkilId,
        muvekkilAd: d.muvekkil.gorunenAd,
        dosyaId: d.id,
        dosyaBaslik,
        tutar: fmt(bakiyeNum),
        tarih: null,
        aciklama: `Kapalı dosyada ${fmtTry(bakiyeNum)} masraf avansı bakiyesi bulunuyor`,
        ...buildAction(d.muvekkilId, d.id, 'DOSYA_MALI', 'mali')
      })
    }

    // ── 7. Kapanmış dosyada kalan vekalet alacağı ──
    let toplamOdenen = new Prisma.Decimal(0)
    for (const t of d.vekaletTaksitleri) {
      toplamOdenen = toplamOdenen.plus(computeTaksitOdemeOzeti(t.tutar, t.odemeler).odenenToplam)
    }
    const toplamVekalet = d.vekaletUcretleri[0]?.toplamTutar ?? new Prisma.Decimal(0)
    const kalanAlacakRaw = toplamVekalet.minus(toplamOdenen)
    const kalanAlacak = kalanAlacakRaw.isNegative() ? new Prisma.Decimal(0) : kalanAlacakRaw
    if (kalanAlacak.gt(EPS) && toplamVekalet.gt(EPS)) {
      let ilkKalanTaksitId: string | undefined
      for (const t of d.vekaletTaksitleri) {
        const kalan = computeTaksitOdemeOzeti(t.tutar, t.odemeler).kalanTutar
        if (kalan.gt(EPS)) {
          ilkKalanTaksitId = t.id
          break
        }
      }
      const kalanAlacakNum = decimalToNum(kalanAlacak)
      addUyari({
        id: `kapali-alacak-${d.id}`,
        tur: 'KAPALI_DOSYA_ALACAK',
        seviye: 'UYARI',
        muvekkilId: d.muvekkilId,
        muvekkilAd: d.muvekkil.gorunenAd,
        dosyaId: d.id,
        dosyaBaslik,
        tutar: fmt(kalanAlacakNum),
        tarih: null,
        aciklama: `Kapalı dosyada ${fmtTry(kalanAlacakNum)} tahsil edilmemiş vekalet ücreti alacağı var`,
        ...(ilkKalanTaksitId
          ? buildAction(d.muvekkilId, d.id, 'VEKALET_TAKSIT', 'vekalet', { taksitId: ilkKalanTaksitId })
          : buildAction(d.muvekkilId, d.id, 'DOSYA_VEKALET', 'vekalet'))
      })
    }
  }

  // ── 8. SMM kesilmemiş tahsilatlar ──
  for (const o of smmEksikOdemeler.filter(isTahsilatOdemeAktif)) {
    if (!o.dosya || !o.muvekkil) continue
    const dosyaBaslik = o.dosya.konuBasligi + (o.dosya.dosyaNo ? ` (${o.dosya.dosyaNo})` : '')
    addUyari({
      id: `smm-${o.id}`,
      tur: 'SMM_KESILMEMIS',
      seviye: 'UYARI',
      muvekkilId: o.muvekkilId,
      muvekkilAd: o.muvekkil.gorunenAd,
      dosyaId: o.dosyaId,
      dosyaBaslik,
      tutar: fmt(Number(o.tutar)),
      tarih: ymdLocal(o.odemeTarihi),
      aciklama: `${fmtTry(Number(o.tutar))} tahsilat için SMM kesilmemiş`,
      ...buildAction(o.muvekkilId, o.dosyaId, 'SMM_ODEME', 'smm', { odemeId: o.id })
    })
  }

  // ── 9. Onay bekleyen kasa hareketleri ──
  for (const r of kasaOnaysizRows) {
    if (!r.dosya || !r.muvekkil) continue
    const dosyaBaslik = r.dosya.konuBasligi + (r.dosya.dosyaNo ? ` (${r.dosya.dosyaNo})` : '')
    const tipEtiket: Record<string, string> = {
      AVANS_GIRISI: 'Avans girişi',
      MASRAF: 'Masraf',
      DUZELTME: 'Düzeltme',
      VEKALET_TAHSILAT: 'Vekalet tahsilatı'
    }
    addUyari({
      id: `onay-${r.id}`,
      tur: 'ONAY_BEKLEYEN_KASA',
      seviye: 'BILGI',
      muvekkilId: r.muvekkil.id,
      muvekkilAd: r.muvekkil.gorunenAd,
      dosyaId: r.dosyaId,
      dosyaBaslik,
      tutar: fmt(Number(r.tutar)),
      tarih: ymdLocal(r.tarih),
      aciklama: `${tipEtiket[r.tip] ?? r.tip} onay bekliyor: ${fmtTry(Number(r.tutar))}`,
      ...buildAction(r.muvekkil.id, r.dosyaId, 'KASA_HAREKET', 'kasa', {
        kasaHareketiId: r.id,
        kasaFilter: 'onaysiz'
      })
    })
  }

  // ── 10. Makbuz numarası eksik tahsilatlar ──
  for (const o of makbuzEksikOdemeler.filter(isTahsilatOdemeAktif)) {
    if (!o.dosya || !o.muvekkil) continue
    const dosyaBaslik = o.dosya.konuBasligi + (o.dosya.dosyaNo ? ` (${o.dosya.dosyaNo})` : '')
    addUyari({
      id: `makbuz-${o.id}`,
      tur: 'MAKBUZ_EKSIK',
      seviye: 'BILGI',
      muvekkilId: o.muvekkilId,
      muvekkilAd: o.muvekkil.gorunenAd,
      dosyaId: o.dosyaId,
      dosyaBaslik,
      tutar: fmt(Number(o.tutar)),
      tarih: ymdLocal(o.odemeTarihi),
      aciklama: `${fmtTry(Number(o.tutar))} tahsilatın makbuz numarası eksik`,
      ...buildAction(o.muvekkilId, o.dosyaId, 'MAKBUZ_ODEME', 'makbuz', { odemeId: o.id })
    })
  }

  // ── 11. Uzun süredir hareketsiz açık dosyalar ──
  // Aktif dosyalar için son kasa hareketi veya vekalet ödemesi tarihi kontrol edilir
  const aktifDosyalar = await prisma.dosya.findMany({
    where: { tenantId, durum: DosyaDurumu.AKTIF },
    select: {
      id: true,
      konuBasligi: true,
      dosyaNo: true,
      muvekkilId: true,
      createdAt: true,
      muvekkil: { select: { id: true, gorunenAd: true } },
      kasaHareketleri: {
        where: { deletedAt: null },
        orderBy: { tarih: 'desc' },
        take: 1,
        select: { tarih: true }
      },
      vekaletTaksitleri: {
        orderBy: { vadeTarihi: 'desc' },
        take: 1,
        select: {
          vadeTarihi: true,
          odemeler: { orderBy: { odemeTarihi: 'desc' }, take: 1, select: { odemeTarihi: true } }
        }
      }
    }
  })

  for (const d of aktifDosyalar) {
    const tarihler: Date[] = [d.createdAt]
    if (d.kasaHareketleri[0]) tarihler.push(d.kasaHareketleri[0].tarih)
    if (d.vekaletTaksitleri[0]) {
      tarihler.push(d.vekaletTaksitleri[0].vadeTarihi)
      if (d.vekaletTaksitleri[0].odemeler[0]) tarihler.push(d.vekaletTaksitleri[0].odemeler[0].odemeTarihi)
    }
    const sonHareket = tarihler.reduce((latest, t) => (t > latest ? t : latest), tarihler[0])

    if (sonHareket < doksanGunOnce) {
      const dosyaBaslik = d.konuBasligi + (d.dosyaNo ? ` (${d.dosyaNo})` : '')
      const gunFark = Math.floor((bugunDate.getTime() - sonHareket.getTime()) / (1000 * 60 * 60 * 24))
      addUyari({
        id: `hareketsiz-${d.id}`,
        tur: 'HAREKETSIZ_DOSYA',
        seviye: 'BILGI',
        muvekkilId: d.muvekkilId,
        muvekkilAd: d.muvekkil.gorunenAd,
        dosyaId: d.id,
        dosyaBaslik,
        tutar: null,
        tarih: ymdLocal(sonHareket),
        aciklama: `Açık dosyada ${gunFark} gündür hareket yok`,
        ...buildAction(d.muvekkilId, d.id, 'DOSYA_GENEL', 'kasa')
      })
    }
  }

  // Önce kritik, sonra uyarı, sonra bilgi; aynı seviyede tarihe göre
  uyarilar.sort((a, b) => {
    const sOrder: Record<UyariSeviyesi, number> = { KRITIK: 0, UYARI: 1, BILGI: 2 }
    const so = sOrder[a.seviye] - sOrder[b.seviye]
    if (so !== 0) return so
    return (a.tarih ?? '').localeCompare(b.tarih ?? '')
  })

  const kritikUyari = uyarilar.filter(u => u.seviye === 'KRITIK').length
  const uyariUyari = uyarilar.filter(u => u.seviye === 'UYARI').length
  const bilgiUyari = uyarilar.filter(u => u.seviye === 'BILGI').length

  return {
    toplamUyari: uyarilar.length,
    kritikUyari,
    uyariUyari,
    bilgiUyari,
    uyarilar
  }
}
