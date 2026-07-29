import { randomBytes } from 'node:crypto'
import {
  KasaHareketTipi,
  KasaOnayDurumu,
  VekaletTaksitOdemeDurumu,
  type Prisma
} from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { serializeTenant } from '../auth/auth.service.js'
import { serializeDosya } from '../dosya/dosya.service.js'
import { serializeMuvekkil } from '../muvekkil/muvekkil.service.js'

const TZ_OFFSET = '+03:00'

export type MuvekkilEkstreDurumLabel =
  | 'Tam Ödendi'
  | 'Kısmi Ödendi'
  | 'Gecikmiş'
  | 'Bekliyor'
  | 'İptal'

function ymdTr(ref: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(ref)
}

function parseItibariyleYmd(itibariyle?: string | null): string {
  if (itibariyle && /^\d{4}-\d{2}-\d{2}$/.test(itibariyle)) return itibariyle
  return ymdTr(new Date())
}

/** İtibarıyla gününün sonu (Europe/Istanbul), dahil. */
function endOfItibariyleDay(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999${TZ_OFFSET}`)
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function sumOdeme(odemeler: { tutar: Prisma.Decimal }[]): number {
  return odemeler.reduce((s, o) => s + Number(o.tutar), 0)
}

function tipEtiket(tip: KasaHareketTipi, tutar: number): string {
  if (tip === 'AVANS_GIRISI') return 'Masraf avansı'
  if (tip === 'MASRAF') return 'Dosya masrafı'
  if (tip === 'DUZELTME') return tutar < 0 ? 'Avans iadesi' : 'Düzeltme'
  return tip
}

function makeBelgeRef(now = new Date()): string {
  const y = now.getFullYear()
  const rnd = randomBytes(3).toString('hex').toUpperCase()
  return `EKSTRE-${y}-${rnd}`
}

export type MuvekkilEkstrePayload = {
  belgeRef: string
  ekstreTarihi: string
  itibariyleTarih: string
  itibariyleAciklama: string
  buro: {
    buroAdi: string
    telefon: string | null
    eposta: string | null
    adres: string | null
  }
  muvekkil: {
    id: string
    gorunenAd: string
    telefonVar: boolean
  }
  dosya: {
    id: string
    konuBasligi: string
    dosyaNo: string | null
    mahkeme: string | null
    icraDairesi: string | null
  }
  vekaletOzeti: {
    kararlastirilanToplam: string
    tahsilEdilenToplam: string
    kalanToplam: string
    tahsilatOrani: number
    gecikmisToplam: string
    sonrakiTaksitVade: string | null
    sonrakiTaksitTutar: string | null
  }
  taksitler: Array<{
    id: string
    taksitNo: number
    vadeTarihi: string
    taksitTutari: string
    odenenToplam: string
    kalanTutar: string
    durum: MuvekkilEkstreDurumLabel
    iptalMi: boolean
    odemeler: Array<{
      id: string
      odemeTarihi: string
      tutar: string
      odemeYontemi: string
      makbuzNo: string
      aciklama: string | null
    }>
  }>
  masrafAvansiOzeti: {
    toplamAlinanAvans: string
    toplamMasraf: string
    pozitifDuzeltme: string
    negatifDuzeltme: string
    muvekkileIade: string
    guncelBakiye: string
  }
  masrafHareketleri: Array<{
    id: string
    tarih: string
    belgeNo: string
    islemTuru: string
    aciklama: string | null
    giris: string
    cikis: string
    bakiyeSonrasi: string
  }>
  dipnot: string
}

/**
 * Müvekkile gösterilecek ekstre — vekalet + ONAYLI kasa.
 * Büro kârlılığı, prim, SMM, onay geçmişi, iç notlar dahil edilmez.
 * İtibarıyla tarihten sonraki ödeme/kasa hareketleri hesaba katılmaz.
 */
export async function buildMuvekkilEkstreForDosya(
  tenantId: string,
  dosyaId: string,
  opts?: { itibariyleTarih?: string | null; belgeRef?: string | null }
): Promise<MuvekkilEkstrePayload | null> {
  const itibariyleYmd = parseItibariyleYmd(opts?.itibariyleTarih)
  const cutoff = endOfItibariyleDay(itibariyleYmd)

  const dosya = await prisma.dosya.findFirst({
    where: { id: dosyaId, tenantId, aktifMi: true },
    include: {
      muvekkil: true,
      tenant: true
    }
  })
  if (!dosya) return null

  const [vekalet, kasaRows] = await Promise.all([
    prisma.vekaletUcreti.findUnique({
      where: { dosyaId },
      include: {
        taksitler: {
          where: { createdAt: { lte: cutoff } },
          orderBy: [{ taksitNo: 'asc' }, { vadeTarihi: 'asc' }],
          include: {
            odemeler: {
              where: { odemeTarihi: { lte: cutoff } },
              orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }]
            }
          }
        }
      }
    }),
    prisma.kasaHareketi.findMany({
      where: {
        tenantId,
        dosyaId,
        onayDurumu: KasaOnayDurumu.ONAYLI,
        tip: { in: [KasaHareketTipi.AVANS_GIRISI, KasaHareketTipi.MASRAF, KasaHareketTipi.DUZELTME] },
        tarih: { lte: cutoff }
      },
      orderBy: [{ tarih: 'asc' }, { createdAt: 'asc' }]
    })
  ])

  const anlasilan = Number(vekalet?.toplamTutar ?? 0)
  let odenenToplam = 0
  let gecikmisToplam = 0
  let sonrakiVade: string | null = null
  let sonrakiTutar: string | null = null

  const durumRefDay = itibariyleYmd

  const taksitlerOut: MuvekkilEkstrePayload['taksitler'] = []

  for (const t of vekalet?.taksitler ?? []) {
    const iptalMi = t.odemeDurumu === VekaletTaksitOdemeDurumu.IPTAL
    const taksitTutari = Number(t.tutar)
    const odenen = sumOdeme(t.odemeler)
    const kalan = iptalMi ? 0 : Math.max(0, taksitTutari - odenen)

    if (!iptalMi) {
      odenenToplam += odenen
    }

    let durum: MuvekkilEkstreDurumLabel
    if (iptalMi) {
      durum = 'İptal'
    } else {
      const vadeYmd = ymdTr(t.vadeTarihi)
      if (vadeYmd < durumRefDay && kalan > 0.0001) durum = 'Gecikmiş'
      else if (odenen <= 0) durum = 'Bekliyor'
      else if (odenen + 0.0001 < taksitTutari) durum = 'Kısmi Ödendi'
      else durum = 'Tam Ödendi'
    }

    if (!iptalMi && durum === 'Gecikmiş') {
      gecikmisToplam += kalan
    }

    if (!iptalMi && kalan > 0.0001) {
      const vadeYmd = ymdTr(t.vadeTarihi)
      if (sonrakiVade == null || vadeYmd < sonrakiVade) {
        sonrakiVade = vadeYmd
        sonrakiTutar = fmt(kalan)
      }
    }

    taksitlerOut.push({
      id: t.id,
      taksitNo: t.taksitNo,
      vadeTarihi: ymdTr(t.vadeTarihi),
      taksitTutari: fmt(taksitTutari),
      odenenToplam: fmt(odenen),
      kalanTutar: fmt(kalan),
      durum,
      iptalMi,
      odemeler: t.odemeler.map((o) => ({
        id: o.id,
        odemeTarihi: o.odemeTarihi.toISOString(),
        tutar: fmt(Number(o.tutar)),
        odemeYontemi: o.odemeYontemi,
        makbuzNo: o.makbuzNo,
        aciklama: o.aciklama
      }))
    })
  }

  const kalanVekalet = Math.max(0, anlasilan - odenenToplam)
  const tahsilatOrani =
    anlasilan > 0 ? Math.round((odenenToplam / anlasilan) * 10000) / 100 : 0

  let avans = 0
  let masraf = 0
  let pozitifDuzeltme = 0
  let negatifDuzeltme = 0
  let running = 0
  const hareketler: MuvekkilEkstrePayload['masrafHareketleri'] = []

  for (const h of kasaRows) {
    const v = Number(h.tutar)
    let giris = 0
    let cikis = 0
    if (h.tip === KasaHareketTipi.AVANS_GIRISI) {
      avans += v
      giris = v
      running += v
    } else if (h.tip === KasaHareketTipi.MASRAF) {
      masraf += v
      cikis = v
      running -= v
    } else if (h.tip === KasaHareketTipi.DUZELTME) {
      if (v >= 0) {
        pozitifDuzeltme += v
        giris = v
        running += v
      } else {
        const abs = Math.abs(v)
        negatifDuzeltme += abs
        cikis = abs
        running += v
      }
    }

    const aciklama =
      h.tip === KasaHareketTipi.MASRAF
        ? [h.masrafTuru, h.ozelMasrafAdi, h.aciklama].filter(Boolean).join(' — ') || null
        : h.aciklama

    hareketler.push({
      id: h.id,
      tarih: h.tarih.toISOString(),
      belgeNo: h.belgeNo,
      islemTuru: tipEtiket(h.tip, v),
      aciklama,
      giris: fmt(giris),
      cikis: fmt(cikis),
      bakiyeSonrasi: fmt(running)
    })
  }

  const duzeltmeNet = pozitifDuzeltme - negatifDuzeltme
  const bakiye = avans - masraf + duzeltmeNet

  const tenantSer = serializeTenant(dosya.tenant) as Record<string, unknown>
  const dosyaSer = serializeDosya(dosya) as Record<string, unknown>
  const muvekkilSer = serializeMuvekkil(dosya.muvekkil) as Record<string, unknown>

  const ekstreTarihi = ymdTr(new Date())
  const belgeRef = opts?.belgeRef?.trim() || makeBelgeRef()

  return {
    belgeRef,
    ekstreTarihi,
    itibariyleTarih: itibariyleYmd,
    itibariyleAciklama: `${itibariyleYmd} tarihi itibarıyla`,
    buro: {
      buroAdi: String(tenantSer.buroAdi ?? ''),
      telefon: (tenantSer.telefon as string | null) ?? null,
      eposta: (tenantSer.eposta as string | null) ?? null,
      adres: (tenantSer.adres as string | null) ?? null
    },
    muvekkil: {
      id: String(muvekkilSer.id),
      gorunenAd: String(muvekkilSer.gorunenAd),
      telefonVar: Boolean(String(muvekkilSer.telefon ?? '').trim())
    },
    dosya: {
      id: String(dosyaSer.id),
      konuBasligi: String(dosyaSer.konuBasligi),
      dosyaNo: (dosyaSer.dosyaNo as string | null) ?? null,
      mahkeme: (dosyaSer.mahkeme as string | null) ?? null,
      icraDairesi: (dosyaSer.icraDairesi as string | null) ?? null
    },
    vekaletOzeti: {
      kararlastirilanToplam: fmt(anlasilan),
      tahsilEdilenToplam: fmt(odenenToplam),
      kalanToplam: fmt(kalanVekalet),
      tahsilatOrani,
      gecikmisToplam: fmt(gecikmisToplam),
      sonrakiTaksitVade: sonrakiVade,
      sonrakiTaksitTutar: sonrakiTutar
    },
    taksitler: taksitlerOut,
    masrafAvansiOzeti: {
      toplamAlinanAvans: fmt(avans),
      toplamMasraf: fmt(masraf),
      pozitifDuzeltme: fmt(pozitifDuzeltme),
      negatifDuzeltme: fmt(negatifDuzeltme),
      muvekkileIade: fmt(negatifDuzeltme),
      guncelBakiye: fmt(bakiye)
    },
    masrafHareketleri: hareketler,
    dipnot:
      'Bu ekstre bilgilendirme amaçlıdır; serbest meslek makbuzu veya tahsilat makbuzu yerine geçmez.'
  }
}

export async function assertDosyaAccessible(
  tenantId: string,
  dosyaId: string
): Promise<{ dosyaId: string; muvekkilId: string } | null> {
  const d = await prisma.dosya.findFirst({
    where: { id: dosyaId, tenantId, aktifMi: true },
    select: { id: true, muvekkilId: true }
  })
  return d ? { dosyaId: d.id, muvekkilId: d.muvekkilId } : null
}

export function requireDosyaOrThrow(
  row: { dosyaId: string; muvekkilId: string } | null
): { dosyaId: string; muvekkilId: string } {
  if (!row) throw new AppError(404, 'Dosya bulunamadı.', 'NOT_FOUND')
  return row
}
