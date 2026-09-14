import { randomUUID } from 'node:crypto'
import type { OfisKasaHareketi, ParaBirimi, Prisma, UserRole } from '@prisma/client'
import {
  OfisKasaIslemTipi,
  OfisKasaOnayDurumu,
  Prisma as PrismaClient
} from '@prisma/client'
import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import type {
  CreateDovizDonusumBody,
  CreateOfisKasaDuzeltmeBody,
  CreateOfisKasaHareketiBody,
  ListOfisKasaHareketleriQuery
} from './ofisKasa.schemas.js'
import {
  assertGiderParaBirimiTry,
  moneyToApiString,
  PARA_BIRIMLERI,
  rateToApiString,
  resolveDovizDonusum,
  resolveParaBirimi
} from '../lib/paraBirimi.js'
import { resolveDovizDonusumKurMeta } from '../lib/kurSnapshot.js'
import { isDigerGelir, isDigerGider } from './ofisKasa.schemas.js'
import { resolveTahsilatiYapanPersonel } from '../lib/tahsilatiYapanPersonel.js'
import {
  type AccountingPeriodMode,
  getAccountingPeriod,
  toLocalYmd,
  isCurrentAccountingPeriod,
  canGoToNextAccountingPeriod
} from '../lib/accountingPeriod.js'

export const OFIS_KASA_DUZELTME_KATEGORI = 'Düzeltme'

export const OFIS_KASA_KAYNAK_ICRA_TAHSILAT = 'ICRA_TAHSILAT'
export const OFIS_KASA_KAYNAK_VEKALET_TAHSILATI = 'VEKALET_TAHSILATI'
export const OFIS_KASA_KATEGORI_VEKALET_TAHSILATI = 'Vekalet Ücreti Tahsilatı'

export type OfisKasaHareketiWithOrijinal = OfisKasaHareketi & {
  orijinalHareket?: { id: string; belgeNo: string } | null
  muvekkil?: { id: string; gorunenAd: string; aktifMi: boolean } | null
  tahsilatiYapanPersonel?: { id: string; adSoyad: string } | null
  createdBy?: { id: string; adSoyad: string; kullaniciAdi: string } | null
}

function decimalToString(d: Prisma.Decimal): string {
  return moneyToApiString(d)
}

type CurrencyBucket = {
  toplamGelir: number
  toplamGider: number
  toplamDuzeltme: number
  dovizCikis: number
  dovizGiris: number
}

function emptyCurrencyBuckets(): Record<ParaBirimi, CurrencyBucket> {
  return {
    TRY: { toplamGelir: 0, toplamGider: 0, toplamDuzeltme: 0, dovizCikis: 0, dovizGiris: 0 },
    USD: { toplamGelir: 0, toplamGider: 0, toplamDuzeltme: 0, dovizCikis: 0, dovizGiris: 0 },
    EUR: { toplamGelir: 0, toplamGider: 0, toplamDuzeltme: 0, dovizCikis: 0, dovizGiris: 0 }
  }
}

function applyToCurrencyBucket(
  buckets: Record<ParaBirimi, CurrencyBucket>,
  islemTipi: OfisKasaIslemTipi,
  paraBirimi: ParaBirimi,
  tutar: number
): void {
  const b = buckets[paraBirimi]
  if (islemTipi === OfisKasaIslemTipi.GELIR) b.toplamGelir += tutar
  else if (islemTipi === OfisKasaIslemTipi.GIDER) b.toplamGider += tutar
  else if (islemTipi === OfisKasaIslemTipi.DUZELTME) b.toplamDuzeltme += tutar
  else if (islemTipi === OfisKasaIslemTipi.DOVIZ_CIKIS) b.dovizCikis += tutar
  else if (islemTipi === OfisKasaIslemTipi.DOVIZ_GIRIS) b.dovizGiris += tutar
}

function currencyBucketBalance(b: CurrencyBucket): number {
  return b.toplamGelir - b.toplamGider + b.toplamDuzeltme - b.dovizCikis + b.dovizGiris
}

function resolveMuvekkilAd(
  h: OfisKasaHareketiWithOrijinal
): string | null {
  const live = h.muvekkil?.gorunenAd?.trim()
  if (live) return live
  const snap = h.muvekkilAdiSnapshot?.trim()
  return snap || null
}

function resolvePersonelAd(h: OfisKasaHareketiWithOrijinal): string | null {
  const p = h.tahsilatiYapanPersonel?.adSoyad?.trim()
  if (p) return p
  const u = h.createdBy
  if (!u) return null
  const name = u.adSoyad?.trim() || u.kullaniciAdi?.trim()
  return name || null
}

export function serializeOfisKasaHareketi(h: OfisKasaHareketiWithOrijinal): Record<string, unknown> {
  const muvekkilAd = resolveMuvekkilAd(h)
  return {
    id: h.id,
    tenantId: h.tenantId,
    islemTipi: h.islemTipi,
    tarih: h.tarih.toISOString(),
    kategori: h.kategori,
    ozelKategoriAdi: h.ozelKategoriAdi,
    aciklama: h.aciklama,
    tutar: decimalToString(h.tutar),
    paraBirimi: h.paraBirimi,
    dovizDonusumId: h.dovizDonusumId,
    kur: rateToApiString(h.kur),
    kurBazParaBirimi: h.kurBazParaBirimi,
    kurKarsiParaBirimi: h.kurKarsiParaBirimi,
    kurKaynagi: h.kurKaynagi ?? null,
    tcmbKurTarihi: h.tcmbKurTarihi ? h.tcmbKurTarihi.toISOString().slice(0, 10) : null,
    tcmbReferansKur: rateToApiString(h.tcmbReferansKur),
    odemeYontemi: h.odemeYontemi,
    belgeNo: h.belgeNo,
    onayDurumu: h.onayDurumu,
    onaylayanId: h.onaylayanId,
    onayTarihi: h.onayTarihi?.toISOString() ?? null,
    redSebebi: h.redSebebi,
    orijinalHareketId: h.orijinalHareketId,
    orijinalBelgeNo: h.orijinalHareket?.belgeNo ?? null,
    otomatikOnayMi: h.otomatikOnayMi,
    tahsilatiYapanUserId: h.tahsilatiYapanUserId,
    tahsilatiYapanPersonelId: h.tahsilatiYapanPersonelId,
    tahsilatiYapanPersonelAd: resolvePersonelAd(h),
    kaynakTipi: h.kaynakTipi,
    kaynakId: h.kaynakId,
    muvekkilId: h.muvekkilId,
    muvekkilAdiSnapshot: h.muvekkilAdiSnapshot,
    muvekkil: h.muvekkilId
      ? {
          id: h.muvekkilId,
          gorunenAd: muvekkilAd,
          aktifMi: h.muvekkil?.aktifMi ?? null
        }
      : null,
    createdById: h.createdById,
    updatedById: h.updatedById,
    deletedAt: h.deletedAt?.toISOString() ?? null,
    deletedById: h.deletedById,
    deleteReason: h.deleteReason,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString()
  }
}

const ofisKasaListInclude = {
  orijinalHareket: { select: { id: true, belgeNo: true } },
  muvekkil: { select: { id: true, gorunenAd: true, aktifMi: true } },
  tahsilatiYapanPersonel: { select: { id: true, adSoyad: true } },
  createdBy: { select: { id: true, adSoyad: true, kullaniciAdi: true } }
} as const

/** Aynı tenant’taki aktif müvekkili doğrular; GIDER’de çağrılmaz. */
export async function resolveAktifMuvekkilForOfisGelir(
  tenantId: string,
  muvekkilId: string | null | undefined
): Promise<{ id: string; gorunenAd: string } | null> {
  if (!muvekkilId) return null
  const row = await prisma.muvekkil.findFirst({
    where: { id: muvekkilId, tenantId },
    select: { id: true, gorunenAd: true, aktifMi: true }
  })
  if (!row) {
    throw new AppError(404, 'Müvekkil bulunamadı.', 'MUVEKKIL_NOT_FOUND')
  }
  if (!row.aktifMi) {
    throw new AppError(400, 'Pasif müvekkile ofis geliri bağlanamaz.', 'MUVEKKIL_INACTIVE')
  }
  return { id: row.id, gorunenAd: row.gorunenAd }
}

async function nextBelgeNo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  tip: OfisKasaIslemTipi,
  tarih: Date
): Promise<string> {
  const year = tarih.getFullYear()
  const p =
    tip === OfisKasaIslemTipi.GELIR
      ? 'OFG'
      : tip === OfisKasaIslemTipi.GIDER
        ? 'OFD'
        : tip === OfisKasaIslemTipi.DOVIZ_CIKIS
          ? 'OFDC'
          : tip === OfisKasaIslemTipi.DOVIZ_GIRIS
            ? 'OFDG'
            : 'OFDZT'
  const prefix = `${p}-${year}-`
  const last = await tx.ofisKasaHareketi.findFirst({
    where: { tenantId, belgeNo: { startsWith: prefix } },
    orderBy: { belgeNo: 'desc' },
    select: { belgeNo: true }
  })
  let n = 1
  if (last?.belgeNo) {
    const parts = last.belgeNo.split('-')
    const num = parseInt(parts[2] ?? '0', 10)
    if (!Number.isNaN(num)) n = num + 1
  }
  return `${p}-${year}-${String(n).padStart(6, '0')}`
}

export async function assertOfisKasaHareketiForTenant(
  tenantId: string,
  id: string
): Promise<OfisKasaHareketi | null> {
  return prisma.ofisKasaHareketi.findFirst({
    where: { id, tenantId, deletedAt: null }
  })
}

export async function listOfisKasaHareketleri(
  tenantId: string,
  query: ListOfisKasaHareketleriQuery
): Promise<{ items: OfisKasaHareketiWithOrijinal[]; total: number }> {
  const { q, islemTipi, onayDurumu, kategori, muvekkilId, paraBirimi, startDate, endDate, page, limit } =
    query
  const skip = (page - 1) * limit

  const tarihFilter: Prisma.DateTimeFilter | undefined =
    startDate || endDate
      ? {
          ...(startDate ? { gte: startDate } : {}),
          ...(endDate ? { lte: endDate } : {})
        }
      : undefined

  const where: Prisma.OfisKasaHareketiWhereInput = {
    tenantId,
    deletedAt: null,
    ...(islemTipi ? { islemTipi } : {}),
    ...(onayDurumu ? { onayDurumu } : {}),
    ...(kategori ? { kategori } : {}),
    ...(muvekkilId ? { muvekkilId } : {}),
    ...(paraBirimi ? { paraBirimi } : {}),
    ...(tarihFilter ? { tarih: tarihFilter } : {}),
    ...(q.length > 0
      ? {
          OR: [
            { belgeNo: { contains: q, mode: 'insensitive' } },
            { aciklama: { contains: q, mode: 'insensitive' } },
            { kategori: { contains: q, mode: 'insensitive' } },
            { ozelKategoriAdi: { contains: q, mode: 'insensitive' } },
            { muvekkilAdiSnapshot: { contains: q, mode: 'insensitive' } },
            { muvekkil: { is: { gorunenAd: { contains: q, mode: 'insensitive' } } } }
          ]
        }
      : {})
  }

  const [total, items] = await prisma.$transaction([
    prisma.ofisKasaHareketi.count({ where }),
    prisma.ofisKasaHareketi.findMany({
      where,
      orderBy: [{ tarih: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
      include: ofisKasaListInclude
    })
  ])

  return { items: items as OfisKasaHareketiWithOrijinal[], total }
}

/** Müvekkil detayı: dosya dışı ofis gelirleri (GELIR + bağlı müvekkil). */
export async function listDosyaDisiOfisGelirleriForMuvekkil(
  tenantId: string,
  muvekkilId: string,
  opts?: { page?: number; limit?: number }
): Promise<{ items: OfisKasaHareketiWithOrijinal[]; total: number } | null> {
  const muvekkil = await prisma.muvekkil.findFirst({
    where: { id: muvekkilId, tenantId },
    select: { id: true }
  })
  if (!muvekkil) return null

  const page = opts?.page ?? 1
  const limit = opts?.limit ?? 50
  const skip = (page - 1) * limit
  const where: Prisma.OfisKasaHareketiWhereInput = {
    tenantId,
    muvekkilId,
    islemTipi: OfisKasaIslemTipi.GELIR,
    deletedAt: null
  }

  const [total, items] = await prisma.$transaction([
    prisma.ofisKasaHareketi.count({ where }),
    prisma.ofisKasaHareketi.findMany({
      where,
      orderBy: [{ tarih: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
      include: ofisKasaListInclude
    })
  ])

  return { items: items as OfisKasaHareketiWithOrijinal[], total }
}

function monthRangeLocal(d: Date): { start: Date; end: Date } {
  const y = d.getFullYear()
  const m = d.getMonth()
  const start = new Date(y, m, 1, 0, 0, 0, 0)
  const end = new Date(y, m + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

async function aggregateApprovedByCurrency(
  tenantId: string,
  tarih?: Prisma.DateTimeFilter
): Promise<Record<ParaBirimi, CurrencyBucket>> {
  const rows = await prisma.ofisKasaHareketi.findMany({
    where: {
      tenantId,
      onayDurumu: OfisKasaOnayDurumu.ONAYLI,
      deletedAt: null,
      ...(tarih ? { tarih } : {})
    },
    select: { islemTipi: true, paraBirimi: true, tutar: true }
  })
  const buckets = emptyCurrencyBuckets()
  for (const r of rows) {
    applyToCurrencyBucket(buckets, r.islemTipi, r.paraBirimi, Number(r.tutar))
  }
  return buckets
}

export async function getOfisKasaOzet(tenantId: string): Promise<{
  toplamGelir: string
  toplamGider: string
  toplamDuzeltme: string
  kasaBakiyesi: string
  onaysizIslemSayisi: number
  buAyGelir: string
  buAyGider: string
  byCurrency: Record<
    ParaBirimi,
    {
      toplamGelir: string
      toplamGider: string
      toplamDuzeltme: string
      kasaBakiyesi: string
      buAyGelir: string
      buAyGider: string
    }
  >
  bakiyeler: Record<ParaBirimi, string>
}> {
  const lifetime = await aggregateApprovedByCurrency(tenantId)
  const { start, end } = monthRangeLocal(new Date())
  const monthBuckets = await aggregateApprovedByCurrency(tenantId, { gte: start, lte: end })

  const onaysizIslemSayisi = await prisma.ofisKasaHareketi.count({
    where: { tenantId, onayDurumu: OfisKasaOnayDurumu.ONAYSIZ, deletedAt: null }
  })

  const tryLifetime = lifetime.TRY
  const tryMonth = monthBuckets.TRY
  const f = (n: number) => n.toFixed(2)

  const byCurrency = {} as Record<
    ParaBirimi,
    {
      toplamGelir: string
      toplamGider: string
      toplamDuzeltme: string
      kasaBakiyesi: string
      buAyGelir: string
      buAyGider: string
    }
  >
  const bakiyeler = {} as Record<ParaBirimi, string>
  for (const pb of PARA_BIRIMLERI) {
    const life = lifetime[pb]
    const month = monthBuckets[pb]
    byCurrency[pb] = {
      toplamGelir: f(life.toplamGelir),
      toplamGider: f(life.toplamGider),
      toplamDuzeltme: f(life.toplamDuzeltme),
      kasaBakiyesi: f(currencyBucketBalance(life)),
      buAyGelir: f(month.toplamGelir),
      buAyGider: f(month.toplamGider)
    }
    bakiyeler[pb] = byCurrency[pb].kasaBakiyesi
  }

  return {
    toplamGelir: f(tryLifetime.toplamGelir),
    toplamGider: f(tryLifetime.toplamGider),
    toplamDuzeltme: f(tryLifetime.toplamDuzeltme),
    kasaBakiyesi: f(currencyBucketBalance(tryLifetime)),
    onaysizIslemSayisi,
    buAyGelir: f(tryMonth.toplamGelir),
    buAyGider: f(tryMonth.toplamGider),
    byCurrency,
    bakiyeler
  }
}

/**
 * Hesap dönemi bazlı anasayfa özeti — mevcut getOfisKasaOzet'e dokunmaz.
 * Tarih sınırlarında Türkiye yerel günü esas alınır (YYYY-MM-DD karşılaştırma).
 * Yalnızca ONAYLI hareketler dahil; REDDEDILDI/ONAYSIZ hariç tutulur.
 */
export async function getOfisKasaAnaSayfaOzet(
  tenantId: string,
  referenceDate?: string
): Promise<{
  mode: string
  period: { bas: string; bit: string; etiket: string }
  isCurrent: boolean
  canGoNext: boolean
  devredenBakiye: string
  donemGelir: string
  donemGider: string
  donemDuzeltmeEtkisi: string
  donemNetSonucu: string
  kasaBakiyesi: string
  bugunGider: string
  byCurrency: Record<
    ParaBirimi,
    {
      devredenBakiye: string
      donemGelir: string
      donemGider: string
      donemDuzeltmeEtkisi: string
      donemNetSonucu: string
      kasaBakiyesi: string
      bugunGider: string
    }
  >
  bakiyeler: Record<ParaBirimi, string>
}> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { hesapDonemiModu: true }
  })
  const mode = tenant.hesapDonemiModu as AccountingPeriodMode
  const ref = referenceDate?.slice(0, 10) ?? toLocalYmd()
  const period = getAccountingPeriod(mode, ref)

  const periodStartDate = new Date(`${period.bas}T00:00:00+03:00`)
  const nextDayAfterEnd = new Date(`${period.bit}T00:00:00+03:00`)
  nextDayAfterEnd.setDate(nextDayAfterEnd.getDate() + 1)

  const approvedWhere = {
    tenantId,
    onayDurumu: OfisKasaOnayDurumu.ONAYLI,
    deletedAt: null
  } as const

  const [allBeforePeriod, periodRows, lifetimeBuckets] = await Promise.all([
    prisma.ofisKasaHareketi.findMany({
      where: { ...approvedWhere, tarih: { lt: periodStartDate } },
      select: { islemTipi: true, tutar: true, paraBirimi: true }
    }),
    prisma.ofisKasaHareketi.findMany({
      where: { ...approvedWhere, tarih: { gte: periodStartDate, lt: nextDayAfterEnd } },
      select: { islemTipi: true, tutar: true, tarih: true, paraBirimi: true }
    }),
    aggregateApprovedByCurrency(tenantId)
  ])

  const devBuckets = emptyCurrencyBuckets()
  for (const r of allBeforePeriod) {
    applyToCurrencyBucket(devBuckets, r.islemTipi, r.paraBirimi, Number(r.tutar))
  }

  const periodBuckets = emptyCurrencyBuckets()
  const bugunGiderByPb = emptyCurrencyBuckets()
  const bugun = toLocalYmd()
  for (const r of periodRows) {
    const t = Number(r.tutar)
    applyToCurrencyBucket(periodBuckets, r.islemTipi, r.paraBirimi, t)
    const tarihYmd = r.tarih.toISOString().slice(0, 10)
    if (r.islemTipi === OfisKasaIslemTipi.GIDER && tarihYmd === bugun) {
      bugunGiderByPb[r.paraBirimi].toplamGider += t
    }
  }

  const tryDev = devBuckets.TRY
  const tryPeriod = periodBuckets.TRY
  const tryLifetime = lifetimeBuckets.TRY
  const devredenBakiye = currencyBucketBalance(tryDev)
  const donemGelir = tryPeriod.toplamGelir
  const donemGider = tryPeriod.toplamGider
  const donemDuz = tryPeriod.toplamDuzeltme
  const donemNet = donemGelir - donemGider + donemDuz
  const kasaBakiyesi = currencyBucketBalance(tryLifetime)
  const bugunGider = bugunGiderByPb.TRY.toplamGider

  const f = (n: number) => n.toFixed(2)
  const byCurrency = {} as Record<
    ParaBirimi,
    {
      devredenBakiye: string
      donemGelir: string
      donemGider: string
      donemDuzeltmeEtkisi: string
      donemNetSonucu: string
      kasaBakiyesi: string
      bugunGider: string
    }
  >
  const bakiyeler = {} as Record<ParaBirimi, string>
  for (const pb of PARA_BIRIMLERI) {
    const dev = devBuckets[pb]
    const per = periodBuckets[pb]
    const life = lifetimeBuckets[pb]
    const net = per.toplamGelir - per.toplamGider + per.toplamDuzeltme
    byCurrency[pb] = {
      devredenBakiye: f(currencyBucketBalance(dev)),
      donemGelir: f(per.toplamGelir),
      donemGider: f(per.toplamGider),
      donemDuzeltmeEtkisi: f(per.toplamDuzeltme),
      donemNetSonucu: f(net),
      kasaBakiyesi: f(currencyBucketBalance(life)),
      bugunGider: f(bugunGiderByPb[pb].toplamGider)
    }
    bakiyeler[pb] = byCurrency[pb].kasaBakiyesi
  }

  return {
    mode,
    period: { bas: period.bas, bit: period.bit, etiket: period.etiket },
    isCurrent: isCurrentAccountingPeriod(period),
    canGoNext: canGoToNextAccountingPeriod(period),
    devredenBakiye: f(devredenBakiye),
    donemGelir: f(donemGelir),
    donemGider: f(donemGider),
    donemDuzeltmeEtkisi: f(donemDuz),
    donemNetSonucu: f(donemNet),
    kasaBakiyesi: f(kasaBakiyesi),
    bugunGider: f(bugunGider),
    byCurrency,
    bakiyeler
  }
}

export async function updateHesapDonemiModu(
  tenantId: string,
  modu: 'MONTHLY' | 'YEARLY'
): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { hesapDonemiModu: modu }
  })
}

export async function createOfisKasaHareketi(
  tenantId: string,
  userId: string,
  actorRole: UserRole,
  body: CreateOfisKasaHareketiBody,
  req: Request
): Promise<OfisKasaHareketi> {
  const meta = getRequestMeta(req)
  const ozel =
    body.islemTipi === OfisKasaIslemTipi.GELIR && isDigerGelir(body.kategori)
      ? body.ozelKategoriAdi?.trim() ?? null
      : body.islemTipi === OfisKasaIslemTipi.GIDER && isDigerGider(body.kategori)
        ? body.ozelKategoriAdi?.trim() ?? null
        : null

  const tutar = new PrismaClient.Decimal(body.tutar)
  const paraBirimi = resolveParaBirimi(body.paraBirimi)
  if (body.islemTipi === OfisKasaIslemTipi.GIDER) {
    assertGiderParaBirimiTry(paraBirimi)
  }

  const tahsilati =
    body.islemTipi === OfisKasaIslemTipi.GELIR
      ? await resolveTahsilatiYapanPersonel(tenantId, userId, actorRole, body.tahsilatiYapanPersonelId ?? body.tahsilatiYapanUserId)
      : null

  // GIDER’de müvekkil asla yazılmaz (tip sonradan gider olsaydı da temizlenirdi).
  const linkedMuvekkil =
    body.islemTipi === OfisKasaIslemTipi.GELIR
      ? await resolveAktifMuvekkilForOfisGelir(tenantId, body.muvekkilId)
      : null

  let attempts = 0
  while (attempts < 5) {
    attempts += 1
    try {
      const created = await prisma.$transaction(async (tx) => {
        const belgeNo = await nextBelgeNo(tx, tenantId, body.islemTipi, body.tarih)
        return tx.ofisKasaHareketi.create({
          data: {
            tenantId,
            islemTipi: body.islemTipi,
            tarih: body.tarih,
            kategori: body.kategori.trim(),
            ozelKategoriAdi: ozel,
            aciklama: body.aciklama?.trim() || null,
            tutar,
            paraBirimi,
            odemeYontemi: body.odemeYontemi,
            belgeNo,
            onayDurumu: OfisKasaOnayDurumu.ONAYSIZ,
            tahsilatiYapanPersonelId: tahsilati?.personelId ?? null,
            tahsilatiYapanUserId: tahsilati?.bagliUserId ?? null,
            muvekkilId: linkedMuvekkil?.id ?? null,
            muvekkilAdiSnapshot: linkedMuvekkil?.gorunenAd ?? null,
            createdById: userId
          }
        })
      })

      await writeAuditLog({
        tenantId,
        userId,
        action: 'OFIS_KASA_HAREKETI_CREATED',
        entityType: 'OfisKasaHareketi',
        entityId: created.id,
        newValue: serializeOfisKasaHareketi({ ...created, orijinalHareket: null }),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      })

      return created
    } catch (e: unknown) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: string }).code) : ''
      if (code === 'P2002' && attempts < 5) continue
      throw e
    }
  }
  throw new AppError(409, 'Belge numarası üretilemedi, tekrar deneyin.', 'BELGE_NO_CONFLICT')
}

/** İcra tahsilat vb. kaynaklı gelir — çift kayıt kaynakTipi+kaynakId ile engellenir. */
export async function createOfisKasaGelirFromKaynakInTx(
  tx: Prisma.TransactionClient,
  opts: {
    tenantId: string
    userId: string
    tarih: Date
    kategori: string
    aciklama: string | null
    kasaTutari: Prisma.Decimal
    paraBirimi: ParaBirimi
    kur?: Prisma.Decimal | null
    kurBazParaBirimi?: ParaBirimi | null
    kurKarsiParaBirimi?: ParaBirimi | null
    odemeYontemi: import('@prisma/client').OfisKasaOdemeYontemi
    tahsilatiYapanPersonelId: string | null
    tahsilatiYapanUserId: string | null
    kaynakTipi: string
    kaynakId: string
  }
): Promise<OfisKasaHareketi> {
  const existing = await tx.ofisKasaHareketi.findFirst({
    where: {
      tenantId: opts.tenantId,
      kaynakTipi: opts.kaynakTipi,
      kaynakId: opts.kaynakId,
      deletedAt: null
    }
  })
  if (existing) return existing

  const belgeNo = await nextBelgeNo(tx, opts.tenantId, OfisKasaIslemTipi.GELIR, opts.tarih)
  return tx.ofisKasaHareketi.create({
    data: {
      tenantId: opts.tenantId,
      islemTipi: OfisKasaIslemTipi.GELIR,
      tarih: opts.tarih,
      kategori: opts.kategori,
      aciklama: opts.aciklama,
      tutar: opts.kasaTutari,
      paraBirimi: opts.paraBirimi,
      kur: opts.kur ?? null,
      kurBazParaBirimi: opts.kurBazParaBirimi ?? null,
      kurKarsiParaBirimi: opts.kurKarsiParaBirimi ?? null,
      odemeYontemi: opts.odemeYontemi,
      belgeNo,
      onayDurumu: OfisKasaOnayDurumu.ONAYSIZ,
      tahsilatiYapanPersonelId: opts.tahsilatiYapanPersonelId,
      tahsilatiYapanUserId: opts.tahsilatiYapanUserId,
      kaynakTipi: opts.kaynakTipi,
      kaynakId: opts.kaynakId,
      createdById: opts.userId
    }
  })
}

export async function approveOfisKasaHareketi(
  tenantId: string,
  userId: string,
  id: string,
  req: Request
): Promise<OfisKasaHareketi> {
  const meta = getRequestMeta(req)
  const row = await assertOfisKasaHareketiForTenant(tenantId, id)
  if (!row) {
    throw new AppError(404, 'Ofis kasa hareketi bulunamadı.', 'NOT_FOUND')
  }
  if (row.onayDurumu !== OfisKasaOnayDurumu.ONAYSIZ) {
    throw new AppError(400, 'Yalnızca onaysız kayıt onaylanabilir.', 'INVALID_STATE')
  }

  const updated = await prisma.ofisKasaHareketi.update({
    where: { id },
    data: {
      onayDurumu: OfisKasaOnayDurumu.ONAYLI,
      onaylayanId: userId,
      onayTarihi: new Date(),
      redSebebi: null,
      updatedById: userId
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'OFIS_KASA_HAREKETI_APPROVED',
    entityType: 'OfisKasaHareketi',
    entityId: id,
    oldValue: { onayDurumu: OfisKasaOnayDurumu.ONAYSIZ },
    newValue: { onayDurumu: OfisKasaOnayDurumu.ONAYLI, onaylayanId: userId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return updated
}

export async function rejectOfisKasaHareketi(
  tenantId: string,
  userId: string,
  id: string,
  redSebebi: string,
  req: Request
): Promise<OfisKasaHareketi> {
  const meta = getRequestMeta(req)
  const row = await assertOfisKasaHareketiForTenant(tenantId, id)
  if (!row) {
    throw new AppError(404, 'Ofis kasa hareketi bulunamadı.', 'NOT_FOUND')
  }
  if (row.onayDurumu !== OfisKasaOnayDurumu.ONAYSIZ) {
    throw new AppError(400, 'Yalnızca onaysız kayıt reddedilebilir.', 'INVALID_STATE')
  }

  const updated = await prisma.ofisKasaHareketi.update({
    where: { id },
    data: {
      onayDurumu: OfisKasaOnayDurumu.REDDEDILDI,
      redSebebi: redSebebi.trim(),
      updatedById: userId
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'OFIS_KASA_HAREKETI_REJECTED',
    entityType: 'OfisKasaHareketi',
    entityId: id,
    oldValue: { onayDurumu: OfisKasaOnayDurumu.ONAYSIZ },
    newValue: { onayDurumu: OfisKasaOnayDurumu.REDDEDILDI, redSebebi: redSebebi.trim() },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return updated
}

export async function createOfisKasaDuzeltme(
  tenantId: string,
  userId: string,
  orijinalId: string,
  body: CreateOfisKasaDuzeltmeBody,
  req: Request
): Promise<OfisKasaHareketi> {
  const meta = getRequestMeta(req)
  const orijinal = await prisma.ofisKasaHareketi.findFirst({
    where: { id: orijinalId, tenantId }
  })
  if (!orijinal) {
    throw new AppError(404, 'Ofis kasa hareketi bulunamadı.', 'NOT_FOUND')
  }
  if (orijinal.onayDurumu !== OfisKasaOnayDurumu.ONAYLI) {
    throw new AppError(400, 'Düzeltme yalnızca onaylı hareketler için oluşturulabilir.', 'INVALID_STATE')
  }
  if (orijinal.islemTipi === OfisKasaIslemTipi.DUZELTME) {
    throw new AppError(400, 'Düzeltme kaydına bağlı ikinci düzeltme bu uçtan açılamaz.', 'INVALID_STATE')
  }

  const tutar = new PrismaClient.Decimal(body.tutar)
  const paraBirimi = resolveParaBirimi(body.paraBirimi ?? orijinal.paraBirimi)
  let attempts = 0
  while (attempts < 5) {
    attempts += 1
    try {
      const created = await prisma.$transaction(async (tx) => {
        const belgeNo = await nextBelgeNo(tx, tenantId, OfisKasaIslemTipi.DUZELTME, body.tarih)
        return tx.ofisKasaHareketi.create({
          data: {
            tenantId,
            islemTipi: OfisKasaIslemTipi.DUZELTME,
            tarih: body.tarih,
            kategori: OFIS_KASA_DUZELTME_KATEGORI,
            ozelKategoriAdi: null,
            aciklama: body.aciklama.trim(),
            tutar,
            paraBirimi,
            odemeYontemi: body.odemeYontemi,
            belgeNo,
            onayDurumu: OfisKasaOnayDurumu.ONAYSIZ,
            orijinalHareketId: orijinal.id,
            createdById: userId
          }
        })
      })

      await writeAuditLog({
        tenantId,
        userId,
        action: 'OFIS_KASA_DUZELTME_CREATED',
        entityType: 'OfisKasaHareketi',
        entityId: created.id,
        newValue: {
          ...serializeOfisKasaHareketi({ ...created, orijinalHareket: { id: orijinal.id, belgeNo: orijinal.belgeNo } }),
          orijinalBelgeNo: orijinal.belgeNo
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      })

      return created
    } catch (e: unknown) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: string }).code) : ''
      if (code === 'P2002' && attempts < 5) continue
      throw e
    }
  }
  throw new AppError(409, 'Belge numarası üretilemedi, tekrar deneyin.', 'BELGE_NO_CONFLICT')
}

export async function createDovizDonusum(
  tenantId: string,
  userId: string,
  body: CreateDovizDonusumBody,
  req: Request
): Promise<{ cikis: OfisKasaHareketi; giris: OfisKasaHareketi }> {
  const meta = getRequestMeta(req)
  const resolved = resolveDovizDonusum({
    kaynakParaBirimi: body.kaynakParaBirimi,
    hedefParaBirimi: body.hedefParaBirimi,
    kaynakTutar: body.kaynakTutar,
    hedefTutar: body.hedefTutar
  })
  const kurMeta = await resolveDovizDonusumKurMeta({
    tarih: body.tarih,
    kaynakParaBirimi: resolved.kaynakParaBirimi,
    hedefParaBirimi: resolved.hedefParaBirimi,
    kurKaynagi: body.kurKaynagi,
    tcmbKurTarihi: body.tcmbKurTarihi,
    tcmbReferansKur: body.tcmbReferansKur
  })
  const dovizDonusumId = randomUUID()
  const aciklama =
    body.aciklama?.trim() ||
    `Döviz dönüşümü: ${moneyToApiString(resolved.kaynakTutar)} ${resolved.kaynakParaBirimi} → ${moneyToApiString(resolved.hedefTutar)} ${resolved.hedefParaBirimi} (${resolved.kurOzeti})`

  let attempts = 0
  while (attempts < 5) {
    attempts += 1
    try {
      const pair = await prisma.$transaction(async (tx) => {
        const belgeCikis = await nextBelgeNo(tx, tenantId, OfisKasaIslemTipi.DOVIZ_CIKIS, body.tarih)
        const belgeGiris = await nextBelgeNo(tx, tenantId, OfisKasaIslemTipi.DOVIZ_GIRIS, body.tarih)
        const cikis = await tx.ofisKasaHareketi.create({
          data: {
            tenantId,
            islemTipi: OfisKasaIslemTipi.DOVIZ_CIKIS,
            tarih: body.tarih,
            kategori: 'Döviz dönüşümü',
            aciklama,
            tutar: resolved.kaynakTutar,
            paraBirimi: resolved.kaynakParaBirimi,
            odemeYontemi: body.odemeYontemi,
            belgeNo: belgeCikis,
            onayDurumu: OfisKasaOnayDurumu.ONAYSIZ,
            dovizDonusumId,
            kur: resolved.kur,
            kurBazParaBirimi: resolved.kaynakParaBirimi,
            kurKarsiParaBirimi: resolved.hedefParaBirimi,
            kurKaynagi: kurMeta.kurKaynagi,
            tcmbKurTarihi: kurMeta.tcmbKurTarihi,
            tcmbReferansKur: kurMeta.tcmbReferansKur,
            createdById: userId
          }
        })
        const giris = await tx.ofisKasaHareketi.create({
          data: {
            tenantId,
            islemTipi: OfisKasaIslemTipi.DOVIZ_GIRIS,
            tarih: body.tarih,
            kategori: 'Döviz dönüşümü',
            aciklama,
            tutar: resolved.hedefTutar,
            paraBirimi: resolved.hedefParaBirimi,
            odemeYontemi: body.odemeYontemi,
            belgeNo: belgeGiris,
            onayDurumu: OfisKasaOnayDurumu.ONAYSIZ,
            dovizDonusumId,
            kur: resolved.kur,
            kurBazParaBirimi: resolved.kaynakParaBirimi,
            kurKarsiParaBirimi: resolved.hedefParaBirimi,
            kurKaynagi: kurMeta.kurKaynagi,
            tcmbKurTarihi: kurMeta.tcmbKurTarihi,
            tcmbReferansKur: kurMeta.tcmbReferansKur,
            createdById: userId
          }
        })
        return { cikis, giris }
      })

      await writeAuditLog({
        tenantId,
        userId,
        action: 'OFIS_KASA_DOVIZ_DONUSUM_CREATED',
        entityType: 'OfisKasaHareketi',
        entityId: pair.cikis.id,
        newValue: {
          dovizDonusumId,
          cikisId: pair.cikis.id,
          girisId: pair.giris.id,
          kurOzeti: resolved.kurOzeti
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      })

      return pair
    } catch (e: unknown) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: string }).code) : ''
      if (code === 'P2002' && attempts < 5) continue
      throw e
    }
  }
  throw new AppError(409, 'Belge numarası üretilemedi, tekrar deneyin.', 'BELGE_NO_CONFLICT')
}

export async function deleteDovizDonusum(
  tenantId: string,
  userId: string,
  dovizDonusumId: string,
  req: Request
): Promise<void> {
  const meta = getRequestMeta(req)
  const rows = await prisma.ofisKasaHareketi.findMany({
    where: { tenantId, dovizDonusumId }
  })
  if (rows.length === 0) {
    throw new AppError(404, 'Döviz dönüşümü bulunamadı.', 'NOT_FOUND')
  }
  if (rows.length !== 2) {
    throw new AppError(400, 'Döviz dönüşümü çifti eksik veya bozuk.', 'INVALID_STATE')
  }
  if (rows.some((r) => r.onayDurumu !== OfisKasaOnayDurumu.ONAYSIZ)) {
    throw new AppError(400, 'Onaylı döviz dönüşümü silinemez.', 'INVALID_STATE')
  }

  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      await tx.ofisKasaHareketi.delete({ where: { id: r.id } })
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'OFIS_KASA_DOVIZ_DONUSUM_DELETED',
    entityType: 'OfisKasaHareketi',
    entityId: dovizDonusumId,
    oldValue: { ids: rows.map((r) => r.id) },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
}

export async function deleteOfisKasaHareketi(tenantId: string, userId: string, id: string, req: Request): Promise<void> {
  const meta = getRequestMeta(req)
  const row = await assertOfisKasaHareketiForTenant(tenantId, id)
  if (!row) {
    throw new AppError(404, 'Ofis kasa hareketi bulunamadı.', 'NOT_FOUND')
  }
  if (row.islemTipi === OfisKasaIslemTipi.GIDER) {
    throw new AppError(
      403,
      'Gider (masraf) kayıtları yalnızca büro sahibi tarafından güvenli silme ile silinebilir.',
      'FORBIDDEN'
    )
  }
  if (row.onayDurumu !== OfisKasaOnayDurumu.ONAYSIZ) {
    throw new AppError(400, 'Onaylı veya reddedilmiş kayıt silinemez.', 'INVALID_STATE')
  }

  if (row.dovizDonusumId) {
    await deleteDovizDonusum(tenantId, userId, row.dovizDonusumId, req)
    return
  }

  await prisma.ofisKasaHareketi.delete({ where: { id } })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'OFIS_KASA_HAREKETI_DELETED',
    entityType: 'OfisKasaHareketi',
    entityId: id,
    oldValue: serializeOfisKasaHareketi({ ...row, orijinalHareket: null }),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
}
