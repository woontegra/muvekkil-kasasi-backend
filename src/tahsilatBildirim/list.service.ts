import { BildirimIsDurumu, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { humanizeBildirimNedeni } from './eligibility.service.js'
import { planAtFromYmdAndMinutes, ymdTr } from './time.js'

export type BildirimIsGorunum = 'PLANLANANLAR' | 'BUGUN' | 'GECMIS' | 'ATLANANLAR'

export type ListJobsParams = {
  gorunum?: BildirimIsGorunum
  page?: number
  limit?: number
}

function serializeJob(row: {
  id: string
  tenantId: string
  muvekkilId: string
  dosyaId: string
  taksitId: string
  kanal: string
  kuralTuru: string
  planlananAt: Date
  kalanTutarSnapshot: Prisma.Decimal
  durum: BildirimIsDurumu
  iptalNedeni: string | null
  atlamaNedeni: string | null
  hataOzeti: string | null
  denemeSayisi: number
  sonDenemeAt: Date | null
  smsParcaSayisi?: number | null
  smsKrediTuketimi?: number | null
  telefonMaskeli?: string | null
  manuelTetikleme?: boolean
  createdAt: Date
  updatedAt: Date
  muvekkil?: { gorunenAd: string }
  dosya?: { konuBasligi: string; dosyaNo: string | null }
  taksit?: { taksitNo: number; vadeTarihi: Date }
}): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenantId,
    muvekkilId: row.muvekkilId,
    muvekkilAd: row.muvekkil?.gorunenAd ?? null,
    dosyaId: row.dosyaId,
    dosyaBaslik: row.dosya?.konuBasligi ?? null,
    dosyaNo: row.dosya?.dosyaNo ?? null,
    taksitId: row.taksitId,
    taksitNo: row.taksit?.taksitNo ?? null,
    vadeTarihi: row.taksit ? ymdTr(row.taksit.vadeTarihi) : null,
    kanal: row.kanal,
    kuralTuru: row.kuralTuru,
    planlananAt: row.planlananAt.toISOString(),
    planYmd: ymdTr(row.planlananAt),
    kalanTutarSnapshot: row.kalanTutarSnapshot.toFixed(2),
    durum: row.durum,
    iptalNedeni: row.iptalNedeni,
    atlamaNedeni: row.atlamaNedeni,
    uygunlukAciklama:
      humanizeBildirimNedeni(row.atlamaNedeni) ??
      humanizeBildirimNedeni(row.iptalNedeni) ??
      (row.durum === BildirimIsDurumu.PLANLANDI || row.durum === BildirimIsDurumu.KUYRUKTA
        ? 'Planlandı'
        : null),
    hataOzeti: row.hataOzeti,
    denemeSayisi: row.denemeSayisi,
    sonDenemeAt: row.sonDenemeAt?.toISOString() ?? null,
    smsParcaSayisi: row.smsParcaSayisi ?? null,
    smsKrediTuketimi: row.smsKrediTuketimi ?? null,
    telefonMaskeli: row.telefonMaskeli ?? null,
    manuelTetikleme: row.manuelTetikleme ?? false,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

function gorunumWhere(tenantId: string, gorunum: BildirimIsGorunum): Prisma.TahsilatBildirimIsiWhereInput {
  const todayYmd = ymdTr(new Date())
  const dayStart = planAtFromYmdAndMinutes(todayYmd, 0)
  const dayEnd = planAtFromYmdAndMinutes(todayYmd, 1439)

  switch (gorunum) {
    case 'PLANLANANLAR':
      return {
        tenantId,
        durum: { in: [BildirimIsDurumu.PLANLANDI, BildirimIsDurumu.KUYRUKTA] }
      }
    case 'BUGUN':
      return {
        tenantId,
        planlananAt: { gte: dayStart, lte: dayEnd }
      }
    case 'GECMIS':
      return {
        tenantId,
        durum: {
          in: [
            BildirimIsDurumu.SIMULASYON_TAMAMLANDI,
            BildirimIsDurumu.GONDERILDI,
            BildirimIsDurumu.TESLIM_EDILDI,
            BildirimIsDurumu.OKUNDU
          ]
        }
      }
    case 'ATLANANLAR':
      return {
        tenantId,
        durum: {
          in: [BildirimIsDurumu.ATLANDI, BildirimIsDurumu.IPTAL_EDILDI, BildirimIsDurumu.BASARISIZ]
        }
      }
    default:
      return { tenantId }
  }
}

export async function getBildirimOzet(tenantId: string): Promise<Record<string, unknown>> {
  const todayYmd = ymdTr(new Date())
  const dayStart = planAtFromYmdAndMinutes(todayYmd, 0)
  const dayEnd = planAtFromYmdAndMinutes(todayYmd, 1439)

  const [bugunPlanlanan, yaklasan, gonderilen, teslimEdilen, simulasyonTamamlanan, atlanan, basarisiz, iptalEdilen, bakiyeYetersiz, ayar] =
    await Promise.all([
      prisma.tahsilatBildirimIsi.count({
        where: {
          tenantId,
          planlananAt: { gte: dayStart, lte: dayEnd },
          durum: { in: [BildirimIsDurumu.PLANLANDI, BildirimIsDurumu.KUYRUKTA] }
        }
      }),
      prisma.tahsilatBildirimIsi.count({
        where: {
          tenantId,
          durum: { in: [BildirimIsDurumu.PLANLANDI, BildirimIsDurumu.KUYRUKTA] }
        }
      }),
      prisma.tahsilatBildirimIsi.count({
        where: { tenantId, durum: BildirimIsDurumu.GONDERILDI }
      }),
      prisma.tahsilatBildirimIsi.count({
        where: { tenantId, durum: BildirimIsDurumu.TESLIM_EDILDI }
      }),
      prisma.tahsilatBildirimIsi.count({
        where: { tenantId, durum: BildirimIsDurumu.SIMULASYON_TAMAMLANDI }
      }),
      prisma.tahsilatBildirimIsi.count({
        where: { tenantId, durum: BildirimIsDurumu.ATLANDI }
      }),
      prisma.tahsilatBildirimIsi.count({
        where: { tenantId, durum: BildirimIsDurumu.BASARISIZ }
      }),
      prisma.tahsilatBildirimIsi.count({
        where: { tenantId, durum: BildirimIsDurumu.IPTAL_EDILDI }
      }),
      prisma.tahsilatBildirimIsi.count({
        where: { tenantId, durum: BildirimIsDurumu.ATLANDI, atlamaNedeni: { contains: 'bakiye', mode: 'insensitive' } }
      }),
      prisma.tahsilatBildirimAyar.findUnique({
        where: { tenantId },
        select: { testModu: true, otomasyonAktif: true }
      })
    ])

  return {
    bugunPlanlanan,
    yaklasan,
    gonderilen,
    teslimEdilen,
    simulasyonTamamlanan,
    atlanan,
    basarisiz,
    iptalEdilen,
    bakiyeYetersiz,
    testModu: ayar?.testModu ?? true,
    otomasyonAktif: ayar?.otomasyonAktif ?? false,
    // Geriye dönük uyumluluk
    bugun: bugunPlanlanan,
    planlananlar: yaklasan,
    simulasyon: simulasyonTamamlanan,
    atlananlar: atlanan + basarisiz + iptalEdilen,
    gecmis: simulasyonTamamlanan
  }
}

export async function listBildirimIsleri(
  tenantId: string,
  params: ListJobsParams
): Promise<{
  items: Record<string, unknown>[]
  total: number
  page: number
  limit: number
  ozet: Record<string, unknown>
}> {
  const gorunum = params.gorunum ?? 'PLANLANANLAR'
  const page = Math.max(1, params.page ?? 1)
  const limit = Math.min(100, Math.max(1, params.limit ?? 50))
  const skip = (page - 1) * limit
  const where = gorunumWhere(tenantId, gorunum)

  const [total, rows, ozet] = await Promise.all([
    prisma.tahsilatBildirimIsi.count({ where }),
    prisma.tahsilatBildirimIsi.findMany({
      where,
      include: {
        muvekkil: { select: { gorunenAd: true } },
        dosya: { select: { konuBasligi: true, dosyaNo: true } },
        taksit: { select: { taksitNo: true, vadeTarihi: true } }
      },
      orderBy: [{ planlananAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit
    }),
    getBildirimOzet(tenantId)
  ])

  return {
    items: rows.map(serializeJob),
    total,
    page,
    limit,
    ozet
  }
}
