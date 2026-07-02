import { KasaOnayDurumu, OfisKasaOnayDurumu } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { getOfisKasaOzet } from '../ofisKasa/ofisKasa.service.js'
import { getTaksitUyarilariForTenant } from './taksitUyari.service.js'

export type DashboardSummaryPayload = {
  onayBekleyenToplam: number
  dosyaKasaOnayBekleyen: number
  ofisKasaOnayBekleyen: number
  smmBekleyen: number
  vadesiGecmisTaksit: number
  ofisKasaBakiyesi: string
  toplamMuvekkil: number
  aktifDosya: number
}

/** Kiracıya özet uyarı ve sayım metrikleri (JWT tenantId). */
export async function getDashboardSummaryForTenant(tenantId: string): Promise<DashboardSummaryPayload> {
  const [dosyaKasaOnayBekleyen, ofisKasaOnayBekleyen, taksitUyarilari, toplamMuvekkil, aktifDosya, ozet] =
    await Promise.all([
      prisma.kasaHareketi.count({
        where: { tenantId, onayDurumu: KasaOnayDurumu.ONAYSIZ }
      }),
      prisma.ofisKasaHareketi.count({
        where: { tenantId, onayDurumu: OfisKasaOnayDurumu.ONAYSIZ }
      }),
      getTaksitUyarilariForTenant(tenantId),
      prisma.muvekkil.count({ where: { tenantId, aktifMi: true } }),
      prisma.dosya.count({ where: { tenantId, aktifMi: true } }),
      getOfisKasaOzet(tenantId)
    ])

  return {
    onayBekleyenToplam: dosyaKasaOnayBekleyen + ofisKasaOnayBekleyen,
    dosyaKasaOnayBekleyen,
    ofisKasaOnayBekleyen,
    smmBekleyen: taksitUyarilari.smmBekleyenCount,
    vadesiGecmisTaksit: taksitUyarilari.vadesiGecmisCount,
    ofisKasaBakiyesi: ozet.kasaBakiyesi,
    toplamMuvekkil,
    aktifDosya
  }
}
