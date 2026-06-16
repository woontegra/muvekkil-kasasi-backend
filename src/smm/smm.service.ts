import { prisma } from '../lib/prisma.js'

export type SmmBekleyenRowDto = {
  id: string
  tenantId: string
  muvekkilId: string
  muvekkilAd: string
  dosyaId: string
  dosyaBaslik: string
  dosyaNo: string | null
  dosyaTuru: string
  tahsilatTarihi: string | null
  tahsilatTuru: string
  tutar: string
  odemeYontemi: string | null
  belgeNo: string | null
  smmKesildiMi: boolean
  taksitId: string
  taksitNo: number | null
}

/** Dashboard ve liste uçlarında ortak filtre (kiracı + SMM kesilmemiş ödeme). */
export function smmBekleyenWhere(tenantId: string) {
  return {
    tenantId,
    smmKesildiMi: false
  }
}

export async function countSmmBekleyenlerForTenant(tenantId: string): Promise<number> {
  return prisma.vekaletTaksitOdeme.count({ where: smmBekleyenWhere(tenantId) })
}

function dec(d: { toFixed: (n: number) => string }): string {
  return d.toFixed(2)
}

const ODEME_YONTEMI_LABEL: Record<string, string> = {
  NAKIT: 'Nakit',
  BANKA: 'Banka',
  KREDI_KARTI: 'Kredi kartı',
  DIGER: 'Diğer'
}

/** Kiracıda SMM kesilmemiş vekalet taksit ödemeleri. */
export async function listSmmBekleyenlerForTenant(tenantId: string): Promise<SmmBekleyenRowDto[]> {
  const rows = await prisma.vekaletTaksitOdeme.findMany({
    where: smmBekleyenWhere(tenantId),
    include: {
      dosya: { select: { konuBasligi: true, dosyaNo: true, dosyaTuru: true } },
      muvekkil: { select: { gorunenAd: true } },
      taksit: { select: { taksitNo: true } }
    },
    orderBy: [{ odemeTarihi: 'desc' }, { createdAt: 'desc' }]
  })

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    muvekkilId: r.muvekkilId,
    muvekkilAd: r.muvekkil.gorunenAd,
    dosyaId: r.dosyaId,
    dosyaBaslik: r.dosya.konuBasligi,
    dosyaNo: r.dosya.dosyaNo,
    dosyaTuru: r.dosya.dosyaTuru,
    tahsilatTarihi: r.odemeTarihi.toISOString(),
    tahsilatTuru: 'Vekalet taksiti',
    tutar: dec(r.tutar),
    odemeYontemi: ODEME_YONTEMI_LABEL[r.odemeYontemi] ?? r.odemeYontemi,
    belgeNo: r.makbuzNo,
    smmKesildiMi: r.smmKesildiMi,
    taksitId: r.taksitId,
    taksitNo: r.taksit.taksitNo
  }))
}
