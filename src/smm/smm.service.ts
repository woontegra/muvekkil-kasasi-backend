import { VekaletTaksitOdemeDurumu } from '@prisma/client'
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
}

/** Dashboard ve liste uçlarında ortak filtre (kiracı + ödenmiş + SMM kesilmemiş). */
export function smmBekleyenWhere(tenantId: string) {
  return {
    tenantId,
    odemeDurumu: VekaletTaksitOdemeDurumu.ODENDI,
    smmKesildiMi: false
  }
}

export async function countSmmBekleyenlerForTenant(tenantId: string): Promise<number> {
  return prisma.vekaletTaksiti.count({ where: smmBekleyenWhere(tenantId) })
}

function dec(d: { toFixed: (n: number) => string }): string {
  return d.toFixed(2)
}

/** Kiracıda ödenmiş ve SMM kesilmemiş vekalet taksitleri (dashboard sayımı ile aynı filtre). */
export async function listSmmBekleyenlerForTenant(tenantId: string): Promise<SmmBekleyenRowDto[]> {
  const rows = await prisma.vekaletTaksiti.findMany({
    where: smmBekleyenWhere(tenantId),
    include: {
      dosya: { select: { konuBasligi: true, dosyaNo: true, dosyaTuru: true } },
      muvekkil: { select: { gorunenAd: true } }
    },
    orderBy: [{ odemeTarihi: 'desc' }, { taksitNo: 'asc' }]
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
    tahsilatTarihi: r.odemeTarihi?.toISOString() ?? null,
    tahsilatTuru: 'Vekalet taksiti',
    tutar: dec(r.tutar),
    odemeYontemi: null,
    belgeNo: r.makbuzNo,
    smmKesildiMi: r.smmKesildiMi
  }))
}
