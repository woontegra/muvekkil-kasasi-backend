import { IcraTahsilatAlacakDurum, type Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import type { IcraTahsilatReportQuery } from './reports.schemas.js'
import { normalizeReportEndDate, normalizeReportStartDate } from './reports.schemas.js'

const DurumEnum = IcraTahsilatAlacakDurum

const ICRA_ALACAK_TURU_LABEL: Record<string, string> = {
  KARSI_TARAF_VEKALET: 'Karşı taraf vekalet',
  ICRA_VEKALET: 'İcra vekalet'
}

const ICRA_ALACAK_DURUM_LABEL: Record<string, string> = {
  ACIK: 'Açık',
  KISMI_ODENDI: 'Kısmi ödendi',
  ODENDI: 'Ödendi',
  GECIKTI: 'Gecikti',
  IPTAL: 'İptal'
}

function num(d: { toString: () => string } | number): number {
  return typeof d === 'number' ? d : Number(d)
}

function dec(d: { toString: () => string }): string {
  return num(d).toFixed(2)
}

function startOfTodayLocal(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

async function odenenToplamForAlacak(alacakId: string): Promise<number> {
  const r = await prisma.icraTahsilatOdeme.aggregate({
    where: { alacakId },
    _sum: { tutar: true }
  })
  return Number(r._sum.tutar ?? 0)
}

async function hesaplaAlacakDurum(
  alacak: Pick<{ id: string; toplamTutar: Prisma.Decimal; durum: IcraTahsilatAlacakDurum }, 'id' | 'toplamTutar' | 'durum'>
): Promise<IcraTahsilatAlacakDurum> {
  if (alacak.durum === DurumEnum.IPTAL) return DurumEnum.IPTAL
  const odenen = await odenenToplamForAlacak(alacak.id)
  const toplam = num(alacak.toplamTutar)
  const kalan = Math.max(0, toplam - odenen)
  if (kalan <= 0.001) return DurumEnum.ODENDI

  const today = startOfTodayLocal()
  const hasOverdueOpen = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM icra_tahsilat_taksit t
    WHERE t.alacak_id = ${alacak.id}
      AND t.vade_tarihi < ${today}
      AND (
        SELECT COALESCE(SUM(o.tutar), 0) FROM icra_tahsilat_odeme o WHERE o.taksit_id = t.id
      ) < t.tutar - 0.001
  `
  if (Number(hasOverdueOpen[0]?.c ?? 0) > 0) return DurumEnum.GECIKTI
  if (odenen > 0.001) return DurumEnum.KISMI_ODENDI
  return DurumEnum.ACIK
}

function odemeYontemiLabel(v: string): string {
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
      return v
  }
}

export async function buildIcraTahsilatReport(tenantId: string, rawQuery: IcraTahsilatReportQuery) {
  const startDate = rawQuery.startDate ? normalizeReportStartDate(rawQuery.startDate) : undefined
  const endDate = rawQuery.endDate ? normalizeReportEndDate(rawQuery.endDate) : undefined
  const { q, alacakTuru, durum, tahsilatiYapanPersonelId } = rawQuery

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, aktifMi: true },
    select: { buroAdi: true, telefon: true, eposta: true, adres: true, vergiNo: true, vergiDairesi: true }
  })
  if (!tenant) {
    throw new Error('Tenant bulunamadı.')
  }

  const createdFilter: Prisma.DateTimeFilter | undefined =
    startDate || endDate
      ? {
          ...(startDate ? { gte: startDate } : {}),
          ...(endDate ? { lte: endDate } : {})
        }
      : undefined

  const where: Prisma.IcraTahsilatAlacagiWhereInput = {
    tenantId,
    ...(alacakTuru ? { alacakTuru } : {}),
    ...(durum === DurumEnum.IPTAL ? { durum: DurumEnum.IPTAL } : {}),
    ...(createdFilter ? { createdAt: createdFilter } : {}),
    ...(tahsilatiYapanPersonelId
      ? { odemeler: { some: { tahsilatiYapanPersonelId } } }
      : {}),
    ...(q.length > 0
      ? {
          OR: [
            { borcluAd: { contains: q, mode: 'insensitive' } },
            { muvekkil: { gorunenAd: { contains: q, mode: 'insensitive' } } },
            { dosya: { konuBasligi: { contains: q, mode: 'insensitive' } } },
            { dosya: { dosyaNo: { contains: q, mode: 'insensitive' } } }
          ]
        }
      : {})
  }

  if (durum && durum !== DurumEnum.IPTAL) {
    where.durum = { not: DurumEnum.IPTAL }
  } else if (!durum) {
    where.durum = { not: DurumEnum.IPTAL }
  }

  const alacakRows = await prisma.icraTahsilatAlacagi.findMany({
    where,
    include: {
      muvekkil: { select: { gorunenAd: true } },
      dosya: { select: { konuBasligi: true } },
      _count: { select: { taksitler: true } },
      odemeler: {
        orderBy: [{ odemeTarihi: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        include: {
          tahsilatiYapanPersonel: { select: { adSoyad: true } },
          tahsilatiYapanUser: { select: { adSoyad: true } }
        }
      }
    },
    orderBy: [{ createdAt: 'desc' }]
  })

  const alacakItems: Record<string, unknown>[] = []
  let toplamAlacak = 0
  let tahsilEdilen = 0

  for (const r of alacakRows) {
    const odenen = await odenenToplamForAlacak(r.id)
    const hesaplananDurum = await hesaplaAlacakDurum(r)
    if (durum && durum !== DurumEnum.IPTAL && hesaplananDurum !== durum) continue

    const kalan = Math.max(0, num(r.toplamTutar) - odenen)
    toplamAlacak += num(r.toplamTutar)
    tahsilEdilen += odenen

    const sonOdeme = r.odemeler[0]
    const personelAd =
      sonOdeme?.tahsilatiYapanPersonel?.adSoyad ??
      sonOdeme?.tahsilatiYapanUser?.adSoyad ??
      null

    alacakItems.push({
      id: r.id,
      borcluAd: r.borcluAd,
      muvekkilAd: r.muvekkil?.gorunenAd ?? null,
      dosyaBaslik: r.dosya?.konuBasligi ?? null,
      alacakTuru: r.alacakTuru,
      alacakTuruLabel: ICRA_ALACAK_TURU_LABEL[r.alacakTuru] ?? r.alacakTuru,
      toplamTutar: dec(r.toplamTutar),
      odenenToplam: odenen.toFixed(2),
      kalanTutar: kalan.toFixed(2),
      taksitSayisi: r._count.taksitler,
      durum: hesaplananDurum,
      durumLabel: ICRA_ALACAK_DURUM_LABEL[hesaplananDurum] ?? hesaplananDurum,
      tahsilatiYapanPersonelAd: personelAd
    })
  }

  const odemeTarihFilter: Prisma.DateTimeFilter | undefined =
    startDate || endDate
      ? {
          ...(startDate ? { gte: startDate } : {}),
          ...(endDate ? { lte: endDate } : {})
        }
      : undefined

  const tahsilatRows = await prisma.icraTahsilatOdeme.findMany({
    where: {
      tenantId,
      ...(odemeTarihFilter ? { odemeTarihi: odemeTarihFilter } : {}),
      ...(tahsilatiYapanPersonelId ? { tahsilatiYapanPersonelId } : {}),
      ...(alacakTuru ? { alacak: { alacakTuru } } : {}),
      alacak: { durum: { not: DurumEnum.IPTAL } }
    },
    include: {
      alacak: { select: { borcluAd: true, alacakTuru: true } },
      tahsilatiYapanPersonel: { select: { adSoyad: true } },
      tahsilatiYapanUser: { select: { adSoyad: true } }
    },
    orderBy: [{ odemeTarihi: 'desc' }, { createdAt: 'desc' }],
    take: 5000
  })

  const tahsilatlar = tahsilatRows.map((o) => ({
    id: o.id,
    tarih: o.odemeTarihi.toISOString(),
    borcluAd: o.alacak.borcluAd,
    alacakTuruLabel: ICRA_ALACAK_TURU_LABEL[o.alacak.alacakTuru] ?? o.alacak.alacakTuru,
    tutar: dec(o.tutar),
    odemeYontemiLabel: odemeYontemiLabel(o.odemeYontemi),
    tahsilatiYapanPersonelAd:
      o.tahsilatiYapanPersonel?.adSoyad ?? o.tahsilatiYapanUser?.adSoyad ?? '—',
    smmDurumu: o.smmKesildiMi ? 'Kesildi' : 'Bekliyor'
  }))

  const today = startOfTodayLocal()
  const vadesiGecmisTaksit = Number(
    (
      await prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*)::bigint AS c FROM icra_tahsilat_taksit t
      INNER JOIN icra_tahsilat_alacak a ON a.id = t.alacak_id
      WHERE a.tenant_id = ${tenantId} AND a.durum != 'IPTAL'
        AND t.vade_tarihi < ${today}
        AND (
          SELECT COALESCE(SUM(o.tutar), 0) FROM icra_tahsilat_odeme o WHERE o.taksit_id = t.id
        ) < t.tutar - 0.001
    `
    )[0]?.c ?? 0
  )

  const smmBekleyen = await prisma.icraTahsilatOdeme.count({
    where: { tenantId, smmKesildiMi: false, alacak: { durum: { not: DurumEnum.IPTAL } } }
  })

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
      alacakTuru: alacakTuru ?? null,
      durum: durum ?? null,
      tahsilatiYapanPersonelId: tahsilatiYapanPersonelId ?? null,
      q: q || null
    },
    totals: {
      toplamAlacak: toplamAlacak.toFixed(2),
      tahsilEdilen: tahsilEdilen.toFixed(2),
      kalanAlacak: Math.max(0, toplamAlacak - tahsilEdilen).toFixed(2),
      vadesiGecmisTaksit,
      smmBekleyen,
      alacakSayisi: alacakItems.length,
      tahsilatSayisi: tahsilatlar.length
    },
    alacaklar: alacakItems,
    tahsilatlar
  }
}
