import { VekaletTaksitOdemeDurumu } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { tahsilatVekaletPersonelWhere } from '../lib/primTahsilatFilter.js'
import {
  computeTaksitDurum,
  serializeVekaletTaksitiWithOzet,
  type TaksitComputedDurum
} from '../vekalet/vekalet.service.js'

const TZ = 'Europe/Istanbul'

export type TahsilatMerkeziGorunum = 'GECIKMIS' | 'BUGUN' | 'YAKLASAN' | 'KISMI'

export type TahsilatMerkeziGorunumFilter =
  | 'GECIKENLER'
  | 'BUGUN'
  | 'YAKLASANLAR'
  | 'KISMI_ODENENLER'
  | 'TUMU'

export type TahsilatMerkeziListeParams = {
  gorunum?: TahsilatMerkeziGorunumFilter
  muvekkilId?: string
  dosyaId?: string
  vadeBas?: string
  vadeBit?: string
  durum?: TaksitComputedDurum
  personelId?: string
  personelBagliUserId?: string | null
  q?: string
  page?: number
  limit?: number
}

export type TahsilatMerkeziSatir = {
  id: string
  muvekkilId: string
  muvekkilAd: string
  muvekkilTelefonVar: boolean
  dosyaId: string
  dosyaBaslik: string
  dosyaNo: string | null
  taksitNo: number
  taksitAciklama: string | null
  taksitTutari: string
  odenenToplam: string
  kalanTutar: string
  vadeTarihi: string
  durum: TaksitComputedDurum
  gunFarki: number
  gorunumler: TahsilatMerkeziGorunum[]
  taksit: Record<string, unknown>
}

export type TahsilatMerkeziOzet = {
  gecikmisToplam: string
  gecikmisAdet: number
  bugunToplam: string
  bugunAdet: number
  yakin7GunToplam: string
  yakin7GunAdet: number
  kismiToplam: string
  kismiAdet: number
  yaklasanAdet: number
}

function ymdTr(ref: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(ref)
}

function vadeToYmdTr(vade: Date): string {
  return ymdTr(vade)
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00+03:00`)
  d.setUTCDate(d.getUTCDate() + days)
  return ymdTr(d)
}

function gunFarkiFromVade(vadeYmd: string, bugunYmd: string): number {
  const v = new Date(`${vadeYmd}T12:00:00+03:00`).getTime()
  const b = new Date(`${bugunYmd}T12:00:00+03:00`).getTime()
  return Math.round((v - b) / 86_400_000)
}

function sumOdeme(tutarlar: { tutar: { toString: () => string } }[]): number {
  return tutarlar.reduce((s, o) => s + Number(o.tutar), 0)
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function classifyGorunumler(
  vadeYmd: string,
  bugunYmd: string,
  kalan: number,
  durum: TaksitComputedDurum
): TahsilatMerkeziGorunum[] {
  if (!Number.isFinite(kalan) || kalan <= 0.001) return []
  const tags: TahsilatMerkeziGorunum[] = []
  if (durum === 'KISMI_ODENDI') tags.push('KISMI')
  if (vadeYmd < bugunYmd) tags.push('GECIKMIS')
  else if (vadeYmd === bugunYmd) tags.push('BUGUN')
  else if (vadeYmd <= addDaysYmd(bugunYmd, 7)) tags.push('YAKLASAN')
  return tags
}

function matchesGorunumFilter(
  gorunumler: TahsilatMerkeziGorunum[],
  filter: TahsilatMerkeziGorunumFilter
): boolean {
  switch (filter) {
    case 'GECIKENLER':
      return gorunumler.includes('GECIKMIS')
    case 'BUGUN':
      return gorunumler.includes('BUGUN')
    case 'YAKLASANLAR':
      return gorunumler.includes('YAKLASAN')
    case 'KISMI_ODENENLER':
      return gorunumler.includes('KISMI')
    case 'TUMU':
      return gorunumler.length > 0 || true
    default:
      return true
  }
}

type RawRow = TahsilatMerkeziSatir

async function loadOpenTaksitRows(tenantId: string, personelId?: string, personelBagliUserId?: string | null): Promise<RawRow[]> {
  const bugun = ymdTr(new Date())

  const personelOdemeWhere =
    personelId != null && personelId !== ''
      ? tahsilatVekaletPersonelWhere(personelId, personelBagliUserId ?? null)
      : null

  const rows = await prisma.vekaletTaksiti.findMany({
    where: {
      tenantId,
      odemeDurumu: { not: VekaletTaksitOdemeDurumu.IPTAL },
      ...(personelOdemeWhere
        ? {
            odemeler: {
              some: personelOdemeWhere
            }
          }
        : {})
    },
    include: {
      odemeler: {
        select: {
          id: true,
          tutar: true,
          odemeTarihi: true,
          makbuzNo: true,
          smmKesildiMi: true,
          tahsilatiYapanPersonelId: true,
          tahsilatiYapanUserId: true
        },
        orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }]
      },
      muvekkil: { select: { gorunenAd: true, telefon: true } },
      dosya: { select: { konuBasligi: true, dosyaNo: true, aktifMi: true } }
    }
  })

  const result: RawRow[] = []

  for (const t of rows) {
    const taksitTutari = Number(t.tutar)
    const odenen = sumOdeme(t.odemeler)
    const kalan = Math.max(0, taksitTutari - odenen)
    if (kalan <= 0.001) continue

    const durum = computeTaksitDurum(t, t.odemeler)
    if (durum === 'ODENDI') continue

    const vadeYmd = vadeToYmdTr(t.vadeTarihi)
    const gorunumler = classifyGorunumler(vadeYmd, bugun, kalan, durum)

    const gunFarki = gunFarkiFromVade(vadeYmd, bugun)
    const telefon = t.muvekkil.telefon?.trim() ?? ''

    result.push({
      id: t.id,
      muvekkilId: t.muvekkilId,
      muvekkilAd: t.muvekkil.gorunenAd,
      muvekkilTelefonVar: telefon.length > 0,
      dosyaId: t.dosyaId,
      dosyaBaslik: t.dosya.konuBasligi,
      dosyaNo: t.dosya.dosyaNo,
      taksitNo: t.taksitNo,
      taksitAciklama: t.aciklama,
      taksitTutari: fmt(taksitTutari),
      odenenToplam: fmt(odenen),
      kalanTutar: fmt(kalan),
      vadeTarihi: vadeYmd,
      durum,
      gunFarki,
      gorunumler,
      taksit: serializeVekaletTaksitiWithOzet(t, t.odemeler)
    })
  }

  result.sort((a, b) => {
    if (a.gunFarki !== b.gunFarki) return a.gunFarki - b.gunFarki
    if (a.vadeTarihi !== b.vadeTarihi) return a.vadeTarihi.localeCompare(b.vadeTarihi)
    return a.muvekkilAd.localeCompare(b.muvekkilAd, 'tr')
  })

  return result
}

function filterRows(rows: RawRow[], params: TahsilatMerkeziListeParams): RawRow[] {
  const gorunum = params.gorunum ?? 'YAKLASANLAR'
  const q = params.q?.trim().toLowerCase()

  return rows.filter((row) => {
    if (gorunum === 'TUMU') {
      // tüm açık taksitler
    } else if (gorunum === 'KISMI_ODENENLER') {
      if (!row.gorunumler.includes('KISMI')) return false
    } else if (!matchesGorunumFilter(row.gorunumler, gorunum)) {
      return false
    }

    if (params.muvekkilId && row.muvekkilId !== params.muvekkilId) return false
    if (params.dosyaId && row.dosyaId !== params.dosyaId) return false
    if (params.durum && row.durum !== params.durum) return false

    if (params.vadeBas && row.vadeTarihi < params.vadeBas) return false
    if (params.vadeBit && row.vadeTarihi > params.vadeBit) return false

    if (q) {
      const hay = `${row.muvekkilAd} ${row.dosyaBaslik} ${row.dosyaNo ?? ''} ${row.taksitNo}`.toLowerCase()
      if (!hay.includes(q)) return false
    }

    return true
  })
}

function computeOzet(rows: RawRow[], bugun: string): TahsilatMerkeziOzet {
  let gecikmisToplam = 0
  let gecikmisAdet = 0
  let bugunToplam = 0
  let bugunAdet = 0
  let yakin7GunToplam = 0
  let yakin7GunAdet = 0
  let kismiToplam = 0
  let kismiAdet = 0
  let yaklasanAdet = 0

  const yakinBit = addDaysYmd(bugun, 7)

  for (const row of rows) {
    const kalan = Number(row.kalanTutar)
    const v = row.vadeTarihi

    if (v < bugun) {
      gecikmisToplam += kalan
      gecikmisAdet += 1
    }
    if (v === bugun) {
      bugunToplam += kalan
      bugunAdet += 1
    }
    if (v > bugun && v <= yakinBit) {
      yakin7GunToplam += kalan
      yakin7GunAdet += 1
    }
    if (row.gorunumler.includes('YAKLASAN')) {
      yaklasanAdet += 1
    }
    if (row.durum === 'KISMI_ODENDI') {
      kismiToplam += kalan
      kismiAdet += 1
    }
  }

  return {
    gecikmisToplam: fmt(gecikmisToplam),
    gecikmisAdet,
    bugunToplam: fmt(bugunToplam),
    bugunAdet,
    yakin7GunToplam: fmt(yakin7GunToplam),
    yakin7GunAdet,
    kismiToplam: fmt(kismiToplam),
    kismiAdet,
    yaklasanAdet
  }
}

export async function getTahsilatMerkeziOzet(
  tenantId: string,
  personelId?: string,
  personelBagliUserId?: string | null
): Promise<TahsilatMerkeziOzet> {
  const bugun = ymdTr(new Date())
  const rows = await loadOpenTaksitRows(tenantId, personelId, personelBagliUserId)
  return computeOzet(rows, bugun)
}

export async function listTahsilatMerkezi(
  tenantId: string,
  params: TahsilatMerkeziListeParams
): Promise<{ items: TahsilatMerkeziSatir[]; total: number; page: number; limit: number; ozet: TahsilatMerkeziOzet }> {
  const bugun = ymdTr(new Date())
  const page = Math.max(1, params.page ?? 1)
  const limit = Math.min(200, Math.max(1, params.limit ?? 50))

  const allRows = await loadOpenTaksitRows(tenantId, params.personelId, params.personelBagliUserId)
  const ozet = computeOzet(allRows, bugun)
  const filtered = filterRows(allRows, params)
  const total = filtered.length
  const start = (page - 1) * limit
  const items = filtered.slice(start, start + limit)

  return { items, total, page, limit, ozet }
}
