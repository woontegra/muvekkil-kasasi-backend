import { KasaOnayDurumu, OfisKasaOnayDurumu, VekaletTaksitOdemeDurumu } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { getOfisKasaOzet } from '../ofisKasa/ofisKasa.service.js'
import { countSmmBekleyenlerForTenant } from '../smm/smm.service.js'

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
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [
    dosyaKasaOnayBekleyen,
    ofisKasaOnayBekleyen,
    smmBekleyen,
    vadesiGecmisTaksit,
    toplamMuvekkil,
    aktifDosya,
    ozet
  ] = await Promise.all([
    prisma.kasaHareketi.count({
      where: { tenantId, onayDurumu: KasaOnayDurumu.ONAYSIZ }
    }),
    prisma.ofisKasaHareketi.count({
      where: { tenantId, onayDurumu: OfisKasaOnayDurumu.ONAYSIZ }
    }),
    countSmmBekleyenlerForTenant(tenantId),
    prisma.vekaletTaksiti.count({
      where: {
        tenantId,
        odemeDurumu: { in: [VekaletTaksitOdemeDurumu.ODENMEDI, VekaletTaksitOdemeDurumu.KISMI_ODENDI] },
        vadeTarihi: { lt: startOfToday }
      }
    }),
    prisma.muvekkil.count({ where: { tenantId, aktifMi: true } }),
    prisma.dosya.count({ where: { tenantId, aktifMi: true } }),
    getOfisKasaOzet(tenantId)
  ])

  return {
    onayBekleyenToplam: dosyaKasaOnayBekleyen + ofisKasaOnayBekleyen,
    dosyaKasaOnayBekleyen,
    ofisKasaOnayBekleyen,
    smmBekleyen,
    vadesiGecmisTaksit,
    ofisKasaBakiyesi: ozet.kasaBakiyesi,
    toplamMuvekkil,
    aktifDosya
  }
}
