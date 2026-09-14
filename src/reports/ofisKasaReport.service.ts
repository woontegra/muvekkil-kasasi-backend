import { prisma } from '../lib/prisma.js'
import { listOfisKasaHareketleri, serializeOfisKasaHareketi } from '../ofisKasa/ofisKasa.service.js'
import { OfisKasaIslemTipi, type ParaBirimi } from '@prisma/client'
import { PARA_BIRIMLERI } from '../lib/paraBirimi.js'
import type { OfisKasaReportQuery } from './reports.schemas.js'
import {
  ISLEM_TIPI_LABEL,
  normalizeReportEndDate,
  normalizeReportStartDate,
  OFIS_KASA_REPORT_MAX_ROWS,
  ONAY_LABEL
} from './reports.schemas.js'

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function odemeLabel(v: string | null | undefined): string {
  switch (v) {
    case 'NAKIT':
      return 'Nakit'
    case 'BANKA':
      return 'Banka'
    case 'KREDI_KARTI':
      return 'Kredi kartı'
    case 'DIGER':
      return 'Diğer'
    default:
      return v ?? '—'
  }
}

function kategoriLabel(kategori: string, ozel: string | null): string {
  if (kategori === 'Diğer gelir' || kategori === 'Diğer gider') {
    return ozel?.trim() ? `${kategori} (${ozel})` : kategori
  }
  return ozel?.trim() || kategori
}

export async function buildOfisKasaReport(tenantId: string, rawQuery: OfisKasaReportQuery) {
  const startDate = rawQuery.startDate ? normalizeReportStartDate(rawQuery.startDate) : undefined
  const endDate = rawQuery.endDate ? normalizeReportEndDate(rawQuery.endDate) : undefined

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, aktifMi: true },
    select: { buroAdi: true, telefon: true, eposta: true, adres: true, vergiNo: true, vergiDairesi: true }
  })
  if (!tenant) {
    throw new Error('Tenant bulunamadı.')
  }

  const { items } = await listOfisKasaHareketleri(tenantId, {
    ...rawQuery,
    startDate,
    endDate,
    page: 1,
    limit: OFIS_KASA_REPORT_MAX_ROWS
  })

  const byCurrency: Record<
    ParaBirimi,
    { toplamGelir: number; toplamGider: number; duzeltmeEtkisi: number; dovizCikis: number; dovizGiris: number }
  > = {
    TRY: { toplamGelir: 0, toplamGider: 0, duzeltmeEtkisi: 0, dovizCikis: 0, dovizGiris: 0 },
    USD: { toplamGelir: 0, toplamGider: 0, duzeltmeEtkisi: 0, dovizCikis: 0, dovizGiris: 0 },
    EUR: { toplamGelir: 0, toplamGider: 0, duzeltmeEtkisi: 0, dovizCikis: 0, dovizGiris: 0 }
  }

  const rows = items.map((h) => {
    const tutar = Number(h.tutar)
    const pb = h.paraBirimi
    const bucket = byCurrency[pb]
    if (h.islemTipi === OfisKasaIslemTipi.GELIR) bucket.toplamGelir += tutar
    else if (h.islemTipi === OfisKasaIslemTipi.GIDER) bucket.toplamGider += tutar
    else if (h.islemTipi === OfisKasaIslemTipi.DUZELTME) bucket.duzeltmeEtkisi += tutar
    else if (h.islemTipi === OfisKasaIslemTipi.DOVIZ_CIKIS) bucket.dovizCikis += tutar
    else if (h.islemTipi === OfisKasaIslemTipi.DOVIZ_GIRIS) bucket.dovizGiris += tutar

    const base = serializeOfisKasaHareketi(h)
    return {
      ...base,
      islemTipiLabel: ISLEM_TIPI_LABEL[h.islemTipi],
      kategoriLabel: kategoriLabel(h.kategori, h.ozelKategoriAdi),
      odemeYontemiLabel: odemeLabel(h.odemeYontemi),
      onayDurumuLabel: ONAY_LABEL[h.onayDurumu]
    }
  })

  const tryTotals = byCurrency.TRY
  const netBakiye = tryTotals.toplamGelir - tryTotals.toplamGider + tryTotals.duzeltmeEtkisi
  const totalsByCurrency: Record<string, { toplamGelir: string; toplamGider: string; duzeltmeEtkisi: string; netBakiye: string }> =
    {}
  for (const pb of PARA_BIRIMLERI) {
    const b = byCurrency[pb]
    const net = b.toplamGelir - b.toplamGider + b.duzeltmeEtkisi - b.dovizCikis + b.dovizGiris
    totalsByCurrency[pb] = {
      toplamGelir: fmt(b.toplamGelir),
      toplamGider: fmt(b.toplamGider),
      duzeltmeEtkisi: fmt(b.duzeltmeEtkisi),
      netBakiye: fmt(net)
    }
  }

  return {
    tenant: {
      buroAdi: tenant.buroAdi,
      telefon: tenant.telefon,
      eposta: tenant.eposta,
      adres: tenant.adres,
      vergiNo: tenant.vergiNo,
      vergiDairesi: tenant.vergiDairesi
    },
    filters: {
      startDate: startDate?.toISOString() ?? null,
      endDate: endDate?.toISOString() ?? null,
      islemTipi: rawQuery.islemTipi ?? null,
      kategori: rawQuery.kategori ?? null,
      onayDurumu: rawQuery.onayDurumu ?? null,
      q: rawQuery.q || null
    },
    totals: {
      toplamGelir: fmt(tryTotals.toplamGelir),
      toplamGider: fmt(tryTotals.toplamGider),
      duzeltmeEtkisi: fmt(tryTotals.duzeltmeEtkisi),
      netBakiye: fmt(netBakiye),
      hareketSayisi: rows.length,
      byCurrency: totalsByCurrency
    },
    rows
  }
}
