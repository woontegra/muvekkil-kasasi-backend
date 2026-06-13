import {
  DosyaDurumu,
  DosyaTuru,
  KasaHareketTipi,
  KasaOnayDurumu,
  MuvekkilTur,
  OdemeYontemi,
  OfisKasaIslemTipi,
  OfisKasaOdemeYontemi,
  OfisKasaOnayDurumu,
  VekaletTaksitOdemeDurumu
} from '@prisma/client'

/** SQLite satırından sütun oku (büyük/küçük harf duyarsız). */
export function pickCol(row: Record<string, unknown>, ...keys: string[]): unknown {
  const lowerMap = new Map<string, string>()
  for (const k of Object.keys(row)) {
    lowerMap.set(k.toLowerCase(), k)
  }
  for (const want of keys) {
    const actual = lowerMap.get(want.toLowerCase())
    if (actual !== undefined) return row[actual]
  }
  return undefined
}

export function pickStr(row: Record<string, unknown>, ...keys: string[]): string | null {
  const v = pickCol(row, ...keys)
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return String(v)
}

export function pickNum(row: Record<string, unknown>, ...keys: string[]): number | null {
  const v = pickCol(row, ...keys)
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function pickBool(row: Record<string, unknown>, ...keys: string[]): boolean {
  const v = pickCol(row, ...keys)
  if (v === true || v === 1) return true
  if (v === false || v === 0) return false
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === '1' || s === 'true' || s === 'yes' || s === 'evet'
  }
  return false
}

export function parseSqliteDate(v: unknown): Date | null {
  if (v == null) return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v.includes('T') ? v : `${v.trim()}T12:00:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export function mapMuvekkilTur(raw: string | null | undefined): MuvekkilTur {
  const u = (raw ?? '').trim().toUpperCase().replace(/-/g, '_')
  if (u.includes('TUZEL')) return MuvekkilTur.TUZEL
  return MuvekkilTur.GERCEK
}

export function mapDosyaTuru(raw: string | null | undefined): DosyaTuru {
  const u = (raw ?? '').trim().toUpperCase()
  if (u === 'DAVA') return DosyaTuru.DAVA
  if (u === 'ICRA') return DosyaTuru.ICRA
  if (u === 'DANISMANLIK' || u === 'DANIŞMANLIK') return DosyaTuru.DANISMANLIK
  if (u) return DosyaTuru.DIGER
  return DosyaTuru.DIGER
}

export function mapDosyaDurumu(raw: string | null | undefined): DosyaDurumu {
  const u = (raw ?? '').trim().toUpperCase()
  if (u === 'PASIF' || u === 'PASİF') return DosyaDurumu.PASIF
  if (u === 'KAPANDI' || u === 'KAPANDI') return DosyaDurumu.KAPANDI
  if (u === 'ARSIV' || u === 'ARŞİV') return DosyaDurumu.ARSIV
  if (u === 'AKTIF' || u === 'AKTİF' || u === '') return DosyaDurumu.AKTIF
  return DosyaDurumu.AKTIF
}

export function mapKasaOnay(raw: string | null | undefined): KasaOnayDurumu {
  const u = (raw ?? '').trim().toUpperCase()
  if (u === 'ONAYLI' || u === 'ONAYLANDI') return KasaOnayDurumu.ONAYLI
  if (u === 'REDDEDILDI' || u === 'REDDEDİLDİ') return KasaOnayDurumu.REDDEDILDI
  if (u === 'ONAYSIZ' || u === '') return KasaOnayDurumu.ONAYSIZ
  return KasaOnayDurumu.ONAYSIZ
}

export function mapOdemeYontemi(raw: string | null | undefined): OdemeYontemi | null {
  const u = (raw ?? '').trim().toUpperCase()
  if (!u) return null
  if (u === 'NAKIT' || u === 'NAKİT') return OdemeYontemi.NAKIT
  if (u === 'BANKA' || u === 'HAVALE' || u === 'EFT') return OdemeYontemi.BANKA
  if (u === 'KREDI_KARTI' || u === 'KART') return OdemeYontemi.KREDI_KARTI
  return OdemeYontemi.DIGER
}

export function mapKasaTipFromRow(row: Record<string, unknown>): KasaHareketTipi {
  if (pickBool(row, 'duzeltme_mi', 'duzeltmeMi', 'is_duzeltme')) return KasaHareketTipi.DUZELTME
  const tip = pickStr(row, 'tip', 'hareket_tipi', 'islem_tipi') ?? ''
  const u = tip.toUpperCase()
  if (u.includes('DUZELTME') || u.includes('DÜZELTME')) return KasaHareketTipi.DUZELTME
  if (u.includes('MASRAF')) return KasaHareketTipi.MASRAF
  if (u.includes('AVANS')) return KasaHareketTipi.AVANS_GIRISI
  return KasaHareketTipi.AVANS_GIRISI
}

export function mapOfisIslemTipi(raw: string | null | undefined, duzeltme: boolean): OfisKasaIslemTipi {
  if (duzeltme) return OfisKasaIslemTipi.DUZELTME
  const u = (raw ?? '').trim().toUpperCase()
  if (u.includes('GELIR') || u.includes('GELİR') || u === 'INCOME') return OfisKasaIslemTipi.GELIR
  if (u.includes('GIDER') || u.includes('GİDER') || u === 'EXPENSE') return OfisKasaIslemTipi.GIDER
  if (u.includes('DUZELTME') || u.includes('DÜZELTME')) return OfisKasaIslemTipi.DUZELTME
  return OfisKasaIslemTipi.GELIR
}

export function mapOfisOnay(raw: string | null | undefined): OfisKasaOnayDurumu {
  const u = (raw ?? '').trim().toUpperCase()
  if (u === 'ONAYLI') return OfisKasaOnayDurumu.ONAYLI
  if (u === 'REDDEDILDI' || u === 'REDDEDİLDİ') return OfisKasaOnayDurumu.REDDEDILDI
  return OfisKasaOnayDurumu.ONAYSIZ
}

export function mapOfisOdeme(raw: string | null | undefined): OfisKasaOdemeYontemi {
  const u = (raw ?? '').trim().toUpperCase()
  if (u === 'NAKIT' || u === 'NAKİT') return OfisKasaOdemeYontemi.NAKIT
  if (u === 'BANKA' || u === 'HAVALE') return OfisKasaOdemeYontemi.BANKA
  if (u === 'KREDI_KARTI' || u === 'KART') return OfisKasaOdemeYontemi.KREDI_KARTI
  return OfisKasaOdemeYontemi.DIGER
}

export function mapVekaletOdeme(row: Record<string, unknown>): VekaletTaksitOdemeDurumu {
  if (pickBool(row, 'odendi_mi', 'odendiMi', 'paid')) return VekaletTaksitOdemeDurumu.ODENDI
  const raw = pickStr(row, 'odeme_durumu', 'odemeDurumu', 'durum') ?? ''
  const u = raw.toUpperCase()
  if (u === 'ODENDI' || u === 'ÖDENDİ' || u === 'PAID') return VekaletTaksitOdemeDurumu.ODENDI
  if (u === 'IPTAL' || u === 'İPTAL' || u === 'CANCELLED') return VekaletTaksitOdemeDurumu.IPTAL
  return VekaletTaksitOdemeDurumu.ODENMEDI
}

export function desktopRowId(row: Record<string, unknown>): number | null {
  const id = pickNum(row, 'id')
  return id != null && Number.isInteger(id) ? id : null
}
