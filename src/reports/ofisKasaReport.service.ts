import { prisma } from '../lib/prisma.js'
import { listOfisKasaHareketleri, serializeOfisKasaHareketi } from '../ofisKasa/ofisKasa.service.js'
import { OfisKasaIslemTipi } from '@prisma/client'
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

  let toplamGelir = 0
  let toplamGider = 0
  let duzeltmeEtkisi = 0

  const rows = items.map((h) => {
    const tutar = Number(h.tutar)
    if (h.islemTipi === OfisKasaIslemTipi.GELIR) toplamGelir += tutar
    else if (h.islemTipi === OfisKasaIslemTipi.GIDER) toplamGider += tutar
    else if (h.islemTipi === OfisKasaIslemTipi.DUZELTME) duzeltmeEtkisi += tutar

    const base = serializeOfisKasaHareketi(h)
    return {
      ...base,
      islemTipiLabel: ISLEM_TIPI_LABEL[h.islemTipi],
      kategoriLabel: kategoriLabel(h.kategori, h.ozelKategoriAdi),
      odemeYontemiLabel: odemeLabel(h.odemeYontemi),
      onayDurumuLabel: ONAY_LABEL[h.onayDurumu]
    }
  })

  const netBakiye = toplamGelir - toplamGider + duzeltmeEtkisi

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
      toplamGelir: fmt(toplamGelir),
      toplamGider: fmt(toplamGider),
      duzeltmeEtkisi: fmt(duzeltmeEtkisi),
      netBakiye: fmt(netBakiye),
      hareketSayisi: rows.length
    },
    rows
  }
}
