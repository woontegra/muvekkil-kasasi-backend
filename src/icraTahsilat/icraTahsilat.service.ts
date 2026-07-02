import type {
  IcraTahsilatAlacagi,
  IcraTahsilatAlacakDurum,
  IcraTahsilatAlacakTuru,
  IcraTahsilatOdeme,
  IcraTahsilatTaksit,
  Prisma,
  UserRole
} from '@prisma/client'
import { IcraTahsilatAlacakDurum as DurumEnum, Prisma as PrismaNs } from '@prisma/client'
import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { tahsilatIcraPersonelWhere } from '../lib/primTahsilatFilter.js'
import { resolveTahsilatiYapanPersonel } from '../lib/tahsilatiYapanPersonel.js'
import {
  createOfisKasaGelirFromKaynakInTx,
  OFIS_KASA_KAYNAK_ICRA_TAHSILAT
} from '../ofisKasa/ofisKasa.service.js'
import { ICRA_ALACAK_DURUM_LABEL, ICRA_ALACAK_TURU_LABEL, icraAlacakTuruToOfisKategori } from './icraTahsilat.constants.js'
import type {
  CreateIcraTahsilatBody,
  CreateIcraTaksitOdemeBody,
  ListIcraTahsilatQuery,
  PatchIcraTahsilatBody,
  PatchIcraTaksitBody
} from './icraTahsilat.schemas.js'
import { resolveIcraTahsilatTipi } from './icraTahsilat.schemas.js'

export type TaksitDurumApi = 'ODENMEDI' | 'KISMI_ODENDI' | 'ODENDI' | 'GECIKTI'
export type SmmDurumApi = 'YOK' | 'BEKLIYOR' | 'KESILDI'

function dec(d: Prisma.Decimal): string {
  return d.toFixed(2)
}

function num(d: Prisma.Decimal): number {
  return Number(d)
}

function startOfTodayLocal(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function monthRangeLocal(): { start: Date; end: Date } {
  const d = new Date()
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

function vadeEkleAy(base: Date, ayOffset: number): Date {
  const d = new Date(base)
  d.setMonth(d.getMonth() + ayOffset)
  return d
}

function bolTaksitTutarlari(toplam: number, adet: number): number[] {
  if (adet < 1) return []
  const birim = Math.round((toplam / adet) * 100) / 100
  const tutarlar = Array.from({ length: adet }, () => birim)
  const fark = Math.round((toplam - birim * adet) * 100) / 100
  if (tutarlar.length > 0) tutarlar[tutarlar.length - 1] = Math.round((tutarlar[tutarlar.length - 1] + fark) * 100) / 100
  return tutarlar
}

function vadeGecmisMi(vade: Date | null): boolean {
  if (!vade) return false
  const today = startOfTodayLocal()
  const v = new Date(vade.getFullYear(), vade.getMonth(), vade.getDate())
  return v < today
}

function hesaplaTaksitDurum(tutar: number, odenen: number, vade: Date | null): TaksitDurumApi {
  const kalan = Math.max(0, tutar - odenen)
  if (odenen <= 0) {
    if (vadeGecmisMi(vade) && kalan > 0) return 'GECIKTI'
    return 'ODENMEDI'
  }
  if (odenen >= tutar - 0.001) return 'ODENDI'
  if (vadeGecmisMi(vade) && kalan > 0) return 'GECIKTI'
  return 'KISMI_ODENDI'
}

function hesaplaSmmDurumu(odemeler: { smmKesildiMi: boolean }[]): {
  smmDurumu: SmmDurumApi
  smmBekleyenOdemeId: string | null
} {
  if (odemeler.length === 0) return { smmDurumu: 'YOK', smmBekleyenOdemeId: null }
  const bekleyen = odemeler.find((o) => !o.smmKesildiMi)
  if (bekleyen) return { smmDurumu: 'BEKLIYOR', smmBekleyenOdemeId: (bekleyen as { id?: string }).id ?? null }
  return { smmDurumu: 'KESILDI', smmBekleyenOdemeId: null }
}

function ofisAciklama(
  borclu: string,
  tur: IcraTahsilatAlacakTuru,
  taksitNo: number | null,
  opts: { pesinat: boolean; pesinTahsil?: boolean }
): string {
  const turEtiket = ICRA_ALACAK_TURU_LABEL[tur]
  if (opts.pesinTahsil) return `İcra tahsilat peşin - ${borclu} - ${turEtiket}`
  if (opts.pesinat) return `İcra tahsilat - ${borclu} - ${turEtiket} - Peşinat`
  return `İcra tahsilat - ${borclu} - ${turEtiket} - Taksit No: ${taksitNo ?? '—'}`
}

function serializeOdeme(
  o: IcraTahsilatOdeme & {
    tahsilatiYapanPersonel?: { adSoyad: string } | null
    tahsilatiYapanUser?: { adSoyad: string; kullaniciAdi: string; eposta: string | null } | null
    createdBy?: { adSoyad: string; kullaniciAdi: string; eposta: string | null } | null
  }
): Record<string, unknown> {
  const tahsilatiYapanAd = resolveTahsilatciDisplayName(o)
  return {
    id: o.id,
    tenantId: o.tenantId,
    alacakId: o.alacakId,
    taksitId: o.taksitId,
    odemeTarihi: o.odemeTarihi.toISOString(),
    tutar: dec(o.tutar),
    odemeYontemi: o.odemeYontemi,
    aciklama: o.aciklama,
    smmKesildiMi: o.smmKesildiMi,
    pesinatMi: o.pesinatMi,
    ofisKasaHareketId: o.ofisKasaHareketId,
    tahsilatiYapanPersonelId: o.tahsilatiYapanPersonelId,
    tahsilatiYapanUserId: o.tahsilatiYapanUserId,
    tahsilatiYapanAd,
    createdById: o.createdById,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString()
  }
}

/** Tahsilatı yapan kişinin görünen adı — personel, kullanıcı veya kaydı oluşturan. */
export function resolveTahsilatciDisplayName(o: {
  tahsilatiYapanPersonel?: { adSoyad: string } | null
  tahsilatiYapanUser?: { adSoyad: string; kullaniciAdi: string; eposta: string | null } | null
  createdBy?: { adSoyad: string; kullaniciAdi: string; eposta: string | null } | null
}): string | null {
  const personel = o.tahsilatiYapanPersonel?.adSoyad?.trim()
  if (personel) return personel
  const user = o.tahsilatiYapanUser?.adSoyad?.trim()
  if (user) return user
  const creator = o.createdBy?.adSoyad?.trim()
  if (creator) return creator
  const login = o.tahsilatiYapanUser?.kullaniciAdi?.trim() || o.createdBy?.kullaniciAdi?.trim()
  if (login) return login
  const mail = o.tahsilatiYapanUser?.eposta?.trim() || o.createdBy?.eposta?.trim()
  if (mail) return mail
  return null
}

const odemeCollectorInclude = {
  tahsilatiYapanPersonel: { select: { adSoyad: true } },
  tahsilatiYapanUser: { select: { adSoyad: true, kullaniciAdi: true, eposta: true } },
  createdBy: { select: { adSoyad: true, kullaniciAdi: true, eposta: true } }
} as const

async function loadSonTahsilatciByAlacak(alacakIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (alacakIds.length === 0) return map

  const odemeler = await prisma.icraTahsilatOdeme.findMany({
    where: { alacakId: { in: alacakIds } },
    orderBy: [{ odemeTarihi: 'desc' }, { createdAt: 'desc' }],
    include: odemeCollectorInclude
  })

  for (const o of odemeler) {
    if (!map.has(o.alacakId)) {
      map.set(o.alacakId, resolveTahsilatciDisplayName(o))
    }
  }
  return map
}

function enrichTaksit(
  taksit: IcraTahsilatTaksit & { odemeler: IcraTahsilatOdeme[] }
): Record<string, unknown> {
  const tutar = num(taksit.tutar)
  const odenenToplam = taksit.odemeler.reduce((s, o) => s + num(o.tutar), 0)
  const kalanTutar = Math.max(0, tutar - odenenToplam)
  const sonOdeme = taksit.odemeler[0] ?? null
  const odemelerWithId = taksit.odemeler.map((o) => ({ ...o, id: o.id }))
  const { smmDurumu, smmBekleyenOdemeId } = hesaplaSmmDurumu(odemelerWithId)
  const bekleyen = taksit.odemeler.find((o) => !o.smmKesildiMi)
  return {
    id: taksit.id,
    alacakId: taksit.alacakId,
    taksitNo: taksit.taksitNo,
    tutar: dec(taksit.tutar),
    vadeTarihi: taksit.vadeTarihi.toISOString(),
    aciklama: taksit.aciklama,
    odenenToplam: odenenToplam.toFixed(2),
    kalanTutar: kalanTutar.toFixed(2),
    durum: hesaplaTaksitDurum(tutar, odenenToplam, taksit.vadeTarihi),
    smmDurumu,
    smmBekleyenOdemeId: bekleyen?.id ?? smmBekleyenOdemeId,
    sonOdemeTarihi: sonOdeme?.odemeTarihi.toISOString() ?? null,
    sonOdemeId: sonOdeme?.id ?? null
  }
}

async function odenenToplamForAlacak(alacakId: string): Promise<number> {
  const r = await prisma.icraTahsilatOdeme.aggregate({
    where: { alacakId },
    _sum: { tutar: true }
  })
  return Number(r._sum.tutar ?? 0)
}

async function hesaplaAlacakDurum(
  alacak: Pick<IcraTahsilatAlacagi, 'id' | 'toplamTutar' | 'durum'>
): Promise<IcraTahsilatAlacakDurum> {
  if (alacak.durum === DurumEnum.IPTAL) return DurumEnum.IPTAL
  const odenen = await odenenToplamForAlacak(alacak.id)
  const toplam = num(alacak.toplamTutar)
  const kalan = Math.max(0, toplam - odenen)
  if (kalan <= 0.001) return DurumEnum.ODENDI

  const today = startOfTodayLocal()
  const gecikmis = await prisma.icraTahsilatTaksit.count({
    where: {
      alacakId: alacak.id,
      vadeTarihi: { lt: today },
      odemeler: {
        none: {}
      }
    }
  })
  const gecikmisKismi = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM icra_tahsilat_taksit t
    WHERE t.alacak_id = ${alacak.id}
      AND t.vade_tarihi < ${today}
      AND (
        SELECT COALESCE(SUM(o.tutar), 0) FROM icra_tahsilat_odeme o WHERE o.taksit_id = t.id
      ) < t.tutar - 0.001
  `
  if (Number(gecikmisKismi[0]?.c ?? 0) > 0 || gecikmis > 0) return DurumEnum.GECIKTI
  if (odenen > 0.001) return DurumEnum.KISMI_ODENDI
  return DurumEnum.ACIK
}

async function assertAlacakForTenant(tenantId: string, id: string) {
  const row = await prisma.icraTahsilatAlacagi.findFirst({
    where: { id, tenantId },
    include: {
      muvekkil: { select: { gorunenAd: true } },
      dosya: { select: { konuBasligi: true, dosyaNo: true } }
    }
  })
  if (!row) throw new AppError(404, 'İcra tahsilat alacağı bulunamadı.', 'NOT_FOUND')
  return row
}

async function assertTaksitForTenant(tenantId: string, taksitId: string) {
  const row = await prisma.icraTahsilatTaksit.findFirst({
    where: { id: taksitId, tenantId },
    include: {
      alacak: true,
      odemeler: { orderBy: [{ odemeTarihi: 'desc' }, { createdAt: 'desc' }] }
    }
  })
  if (!row) throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')
  return row
}

async function icraOdemeKaydetInTx(
  tx: Prisma.TransactionClient,
  opts: {
    tenantId: string
    userId: string
    actorRole: UserRole
    alacak: Pick<IcraTahsilatAlacagi, 'id' | 'borcluAd' | 'alacakTuru'>
    taksitId: string | null
    taksitNo: number | null
    tutar: Prisma.Decimal
    odemeTarihi: Date
    odemeYontemi: import('@prisma/client').OfisKasaOdemeYontemi
    aciklama: string | null
    pesinatMi: boolean
    pesinTahsil?: boolean
    tahsilatiYapanPersonelId: string | null
    tahsilatiYapanUserId: string | null
  }
): Promise<IcraTahsilatOdeme> {
  const odeme = await tx.icraTahsilatOdeme.create({
    data: {
      tenantId: opts.tenantId,
      alacakId: opts.alacak.id,
      taksitId: opts.taksitId,
      odemeTarihi: opts.odemeTarihi,
      tutar: opts.tutar,
      odemeYontemi: opts.odemeYontemi,
      aciklama: opts.aciklama,
      pesinatMi: opts.pesinatMi,
      smmKesildiMi: false,
      tahsilatiYapanPersonelId: opts.tahsilatiYapanPersonelId,
      tahsilatiYapanUserId: opts.userId,
      createdById: opts.userId
    }
  })

  const ofis = await createOfisKasaGelirFromKaynakInTx(tx, {
    tenantId: opts.tenantId,
    userId: opts.userId,
    tarih: opts.odemeTarihi,
    kategori: icraAlacakTuruToOfisKategori(opts.alacak.alacakTuru),
    aciklama: ofisAciklama(opts.alacak.borcluAd, opts.alacak.alacakTuru, opts.taksitNo, {
      pesinat: opts.pesinatMi,
      pesinTahsil: opts.pesinTahsil
    }),
    tutar: opts.tutar,
    odemeYontemi: opts.odemeYontemi,
    tahsilatiYapanPersonelId: opts.tahsilatiYapanPersonelId,
    tahsilatiYapanUserId: opts.userId,
    kaynakTipi: OFIS_KASA_KAYNAK_ICRA_TAHSILAT,
    kaynakId: odeme.id
  })

  return tx.icraTahsilatOdeme.update({
    where: { id: odeme.id },
    data: { ofisKasaHareketId: ofis.id }
  })
}

export async function getIcraTahsilatOzet(tenantId: string): Promise<Record<string, unknown>> {
  const alacaklar = await prisma.icraTahsilatAlacagi.findMany({
    where: { tenantId, durum: { not: DurumEnum.IPTAL } },
    select: { id: true, toplamTutar: true }
  })
  let toplamAlacak = 0
  let tahsilEdilen = 0
  for (const a of alacaklar) {
    toplamAlacak += num(a.toplamTutar)
    tahsilEdilen += await odenenToplamForAlacak(a.id)
  }

  const today = startOfTodayLocal()
  const gecikmis = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM icra_tahsilat_taksit t
    INNER JOIN icra_tahsilat_alacak a ON a.id = t.alacak_id
    WHERE a.tenant_id = ${tenantId} AND a.durum != 'IPTAL'
      AND t.vade_tarihi < ${today}
      AND (
        SELECT COALESCE(SUM(o.tutar), 0) FROM icra_tahsilat_odeme o WHERE o.taksit_id = t.id
      ) < t.tutar - 0.001
  `

  const { start, end } = monthRangeLocal()
  const buAy = await prisma.icraTahsilatOdeme.aggregate({
    where: { tenantId, odemeTarihi: { gte: start, lte: end } },
    _sum: { tutar: true }
  })

  const smmBekleyen = await prisma.icraTahsilatOdeme.count({
    where: { tenantId, smmKesildiMi: false }
  })

  return {
    toplamAlacak: toplamAlacak.toFixed(2),
    tahsilEdilen: tahsilEdilen.toFixed(2),
    kalanAlacak: Math.max(0, toplamAlacak - tahsilEdilen).toFixed(2),
    vadesiGecmisTaksit: Number(gecikmis[0]?.c ?? 0),
    buAyTahsilat: Number(buAy._sum.tutar ?? 0).toFixed(2),
    smmBekleyen
  }
}

export async function listIcraTahsilat(
  tenantId: string,
  query: ListIcraTahsilatQuery
): Promise<{ ozet: Record<string, unknown>; items: Record<string, unknown>[]; total: number }> {
  const { q, alacakTuru, durum, tahsilatiYapanPersonelId, startDate, endDate, page, limit } = query
  const skip = (page - 1) * limit

  const tarihFilter: Prisma.DateTimeFilter | undefined =
    startDate || endDate
      ? {
          ...(startDate ? { gte: startDate } : {}),
          ...(endDate ? { lte: endDate } : {})
        }
      : undefined

  const where: Prisma.IcraTahsilatAlacagiWhereInput = {
    tenantId,
    ...(alacakTuru ? { alacakTuru } : {}),
    ...(durum === DurumEnum.IPTAL ? { durum: DurumEnum.IPTAL } : durum ? {} : {}),
    ...(tarihFilter ? { createdAt: tarihFilter } : {}),
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

  if (tahsilatiYapanPersonelId) {
    const personel = await prisma.primPersonel.findFirst({
      where: { id: tahsilatiYapanPersonelId, tenantId },
      select: { bagliUserId: true }
    })
    where.odemeler = {
      some: tahsilatIcraPersonelWhere(tahsilatiYapanPersonelId, personel?.bagliUserId ?? null)
    }
  }

  if (durum && durum !== DurumEnum.IPTAL) {
    where.durum = { not: DurumEnum.IPTAL }
  }

  const rows = await prisma.icraTahsilatAlacagi.findMany({
    where,
    include: {
      muvekkil: { select: { gorunenAd: true } },
      dosya: { select: { konuBasligi: true } },
      taksitler: { select: { id: true } },
      _count: { select: { taksitler: true } }
    },
    orderBy: [{ createdAt: 'desc' }],
    skip,
    take: limit
  })

  const total = await prisma.icraTahsilatAlacagi.count({ where })

  const sonTahsilatciMap = await loadSonTahsilatciByAlacak(rows.map((r) => r.id))

  const items: Record<string, unknown>[] = []
  for (const r of rows) {
    const odenen = await odenenToplamForAlacak(r.id)
    const hesaplananDurum = await hesaplaAlacakDurum(r)
    if (durum && durum !== DurumEnum.IPTAL && hesaplananDurum !== durum) continue
    const sonAd = sonTahsilatciMap.get(r.id) ?? null
    items.push({
      id: r.id,
      borcluAd: r.borcluAd,
      muvekkilId: r.muvekkilId,
      muvekkilAd: r.muvekkil?.gorunenAd ?? null,
      dosyaId: r.dosyaId,
      dosyaBaslik: r.dosya?.konuBasligi ?? null,
      alacakTuru: r.alacakTuru,
      alacakTuruLabel: ICRA_ALACAK_TURU_LABEL[r.alacakTuru],
      toplamTutar: dec(r.toplamTutar),
      pesinatTutar: dec(r.pesinatTutar),
      odenenToplam: odenen.toFixed(2),
      kalanTutar: Math.max(0, num(r.toplamTutar) - odenen).toFixed(2),
      taksitSayisi: r._count.taksitler,
      durum: hesaplananDurum,
      durumLabel: ICRA_ALACAK_DURUM_LABEL[hesaplananDurum],
      kayitTarihi: r.createdAt.toISOString(),
      iptalMi: r.durum === DurumEnum.IPTAL,
      sonTahsilatciAd: sonAd,
      tahsilatiYapanAd: sonAd
    })
  }

  const ozet = await getIcraTahsilatOzet(tenantId)
  return { ozet, items, total }
}

export async function getIcraTahsilatById(tenantId: string, id: string): Promise<Record<string, unknown>> {
  const alacak = await assertAlacakForTenant(tenantId, id)
  const taksitler = await prisma.icraTahsilatTaksit.findMany({
    where: { alacakId: id, tenantId },
    include: { odemeler: { orderBy: [{ odemeTarihi: 'desc' }, { createdAt: 'desc' }] } },
    orderBy: { taksitNo: 'asc' }
  })
  const odemeler = await prisma.icraTahsilatOdeme.findMany({
    where: { alacakId: id, tenantId },
    orderBy: [{ odemeTarihi: 'desc' }, { createdAt: 'desc' }],
    include: odemeCollectorInclude
  })

  const odenen = odemeler.reduce((s, o) => s + num(o.tutar), 0)
  const taksitToplam = taksitler.reduce((s, t) => s + num(t.tutar), 0)
  const pesinat = num(alacak.pesinatTutar)
  const toplam = num(alacak.toplamTutar)
  const hesaplananDurum = await hesaplaAlacakDurum(alacak)

  return {
    id: alacak.id,
    alacakTuru: alacak.alacakTuru,
    alacakTuruLabel: ICRA_ALACAK_TURU_LABEL[alacak.alacakTuru],
    borcluAd: alacak.borcluAd,
    muvekkilId: alacak.muvekkilId,
    muvekkilAd: alacak.muvekkil?.gorunenAd ?? null,
    dosyaId: alacak.dosyaId,
    dosyaBaslik: alacak.dosya?.konuBasligi ?? null,
    dosyaNo: alacak.dosya?.dosyaNo ?? null,
    toplamTutar: dec(alacak.toplamTutar),
    pesinatTutar: dec(alacak.pesinatTutar),
    taksitSayisi: alacak.taksitSayisi,
    ilkVadeTarihi: alacak.ilkVadeTarihi.toISOString(),
    varsayilanOdemeYontemi: alacak.varsayilanOdemeYontemi,
    aciklama: alacak.aciklama,
    durum: hesaplananDurum,
    durumLabel: ICRA_ALACAK_DURUM_LABEL[hesaplananDurum],
    iptalMi: alacak.durum === DurumEnum.IPTAL,
    ozet: {
      toplamAlacak: dec(alacak.toplamTutar),
      taksitToplami: taksitToplam.toFixed(2),
      pesinatTutar: pesinat.toFixed(2),
      tahsilEdilen: odenen.toFixed(2),
      kalan: Math.max(0, toplam - odenen).toFixed(2),
      dagitilmamisFark:
        taksitler.length === 0
          ? Math.max(0, Math.round((toplam - odenen) * 100) / 100)
          : Math.round((toplam - pesinat - taksitToplam) * 100) / 100,
      taksitToplamiEslesiyor:
        taksitler.length === 0
          ? Math.abs(toplam - odenen) < 0.01
          : Math.abs(toplam - pesinat - taksitToplam) < 0.01
    },
    taksitler: taksitler.map((t) => enrichTaksit(t)),
    odemeler: odemeler.map(serializeOdeme)
  }
}

export async function createIcraTahsilatAlacagi(
  tenantId: string,
  userId: string,
  actorRole: UserRole,
  body: CreateIcraTahsilatBody,
  req: Request
): Promise<Record<string, unknown>> {
  const meta = getRequestMeta(req)
  const tip = resolveIcraTahsilatTipi(body)
  const tahsilatTarihi = body.tahsilatTarihi ?? new Date()

  if (body.muvekkilId) {
    const m = await prisma.muvekkil.findFirst({ where: { id: body.muvekkilId, tenantId } })
    if (!m) throw new AppError(400, 'Müvekkil bulunamadı.', 'NOT_FOUND')
  }
  if (body.dosyaId) {
    const d = await prisma.dosya.findFirst({ where: { id: body.dosyaId, tenantId } })
    if (!d) throw new AppError(400, 'Dosya bulunamadı.', 'NOT_FOUND')
    if (body.muvekkilId && d.muvekkilId !== body.muvekkilId) {
      throw new AppError(400, 'Dosya seçilen müvekkile ait değil.', 'INVALID_STATE')
    }
  }

  if (tip === 'PESIN_TAHSIL') {
    const tahsilati = await resolveTahsilatiYapanPersonel(
      tenantId,
      userId,
      actorRole,
      body.tahsilatiYapanPersonelId ?? body.tahsilatiYapanUserId
    )

    const created = await prisma.$transaction(async (tx) => {
      const alacak = await tx.icraTahsilatAlacagi.create({
        data: {
          tenantId,
          alacakTuru: body.alacakTuru,
          borcluAd: body.borcluAd.trim(),
          muvekkilId: body.muvekkilId ?? null,
          dosyaId: body.dosyaId ?? null,
          toplamTutar: new PrismaNs.Decimal(body.toplamTutar),
          pesinatTutar: new PrismaNs.Decimal(0),
          taksitSayisi: 0,
          ilkVadeTarihi: body.ilkVadeTarihi ?? tahsilatTarihi,
          varsayilanOdemeYontemi: body.odemeYontemi,
          aciklama: body.aciklama?.trim() || null,
          durum: DurumEnum.ODENDI,
          createdById: userId
        }
      })

      await icraOdemeKaydetInTx(tx, {
        tenantId,
        userId,
        actorRole,
        alacak,
        taksitId: null,
        taksitNo: null,
        tutar: new PrismaNs.Decimal(body.toplamTutar),
        odemeTarihi: tahsilatTarihi,
        odemeYontemi: body.odemeYontemi,
        aciklama: body.aciklama?.trim() || null,
        pesinatMi: false,
        pesinTahsil: true,
        tahsilatiYapanPersonelId: tahsilati.personelId,
        tahsilatiYapanUserId: tahsilati.bagliUserId
      })

      return alacak
    })

    await writeAuditLog({
      tenantId,
      userId,
      action: 'ICRA_TAHSILAT_ALACAK_CREATED',
      entityType: 'IcraTahsilatAlacagi',
      entityId: created.id,
      newValue: { borcluAd: body.borcluAd, toplamTutar: body.toplamTutar, tahsilatTipi: tip },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })

    return getIcraTahsilatById(tenantId, created.id)
  }

  const pesinat = tip === 'PESINAT_TAKSIT' ? Number(body.pesinatTutar ?? 0) : 0
  const kalan = Math.round((body.toplamTutar - pesinat) * 100) / 100
  if (kalan <= 0.001 && body.taksitSayisi > 0) {
    throw new AppError(400, 'Peşinat toplam tutarı karşılıyorsa taksit oluşturulamaz.', 'INVALID_STATE')
  }

  const tutarlar = bolTaksitTutarlari(kalan, body.taksitSayisi)
  const tahsilati =
    tip === 'PESINAT_TAKSIT'
      ? await resolveTahsilatiYapanPersonel(
          tenantId,
          userId,
          actorRole,
          body.tahsilatiYapanPersonelId ?? body.tahsilatiYapanUserId
        )
      : null

  const ilkVade = body.ilkVadeTarihi ?? new Date()

  const created = await prisma.$transaction(async (tx) => {
    const alacak = await tx.icraTahsilatAlacagi.create({
      data: {
        tenantId,
        alacakTuru: body.alacakTuru,
        borcluAd: body.borcluAd.trim(),
        muvekkilId: body.muvekkilId ?? null,
        dosyaId: body.dosyaId ?? null,
        toplamTutar: new PrismaNs.Decimal(body.toplamTutar),
        pesinatTutar: new PrismaNs.Decimal(pesinat),
        taksitSayisi: body.taksitSayisi,
        ilkVadeTarihi: ilkVade,
        varsayilanOdemeYontemi: body.odemeYontemi,
        aciklama: body.aciklama?.trim() || null,
        createdById: userId
      }
    })

    for (let i = 0; i < tutarlar.length; i += 1) {
      await tx.icraTahsilatTaksit.create({
        data: {
          tenantId,
          alacakId: alacak.id,
          taksitNo: i + 1,
          tutar: new PrismaNs.Decimal(tutarlar[i]),
          vadeTarihi: vadeEkleAy(ilkVade, i)
        }
      })
    }

    if (pesinat > 0.001 && tahsilati) {
      await icraOdemeKaydetInTx(tx, {
        tenantId,
        userId,
        actorRole,
        alacak,
        taksitId: null,
        taksitNo: null,
        tutar: new PrismaNs.Decimal(pesinat),
        odemeTarihi: tahsilatTarihi,
        odemeYontemi: body.odemeYontemi,
        aciklama: body.aciklama?.trim() || null,
        pesinatMi: true,
        tahsilatiYapanPersonelId: tahsilati.personelId,
        tahsilatiYapanUserId: tahsilati.bagliUserId
      })
    }

    return alacak
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'ICRA_TAHSILAT_ALACAK_CREATED',
    entityType: 'IcraTahsilatAlacagi',
    entityId: created.id,
    newValue: { borcluAd: body.borcluAd, toplamTutar: body.toplamTutar, tahsilatTipi: tip },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getIcraTahsilatById(tenantId, created.id)
}

export async function patchIcraTahsilatAlacagi(
  tenantId: string,
  userId: string,
  id: string,
  body: PatchIcraTahsilatBody,
  req: Request
): Promise<Record<string, unknown>> {
  const meta = getRequestMeta(req)
  const row = await assertAlacakForTenant(tenantId, id)
  if (row.durum === DurumEnum.IPTAL && body.durum !== DurumEnum.IPTAL) {
    throw new AppError(400, 'İptal edilmiş alacak güncellenemez.', 'INVALID_STATE')
  }

  await prisma.icraTahsilatAlacagi.update({
    where: { id },
    data: {
      ...(body.borcluAd ? { borcluAd: body.borcluAd.trim() } : {}),
      ...(body.muvekkilId !== undefined ? { muvekkilId: body.muvekkilId } : {}),
      ...(body.dosyaId !== undefined ? { dosyaId: body.dosyaId } : {}),
      ...(body.aciklama !== undefined ? { aciklama: body.aciklama?.trim() || null } : {}),
      ...(body.durum === DurumEnum.IPTAL ? { durum: DurumEnum.IPTAL } : {}),
      updatedById: userId
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: body.durum === DurumEnum.IPTAL ? 'ICRA_TAHSILAT_ALACAK_CANCELLED' : 'ICRA_TAHSILAT_ALACAK_UPDATED',
    entityType: 'IcraTahsilatAlacagi',
    entityId: id,
    newValue: body,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getIcraTahsilatById(tenantId, id)
}

export async function patchIcraTahsilatTaksit(
  tenantId: string,
  userId: string,
  taksitId: string,
  body: PatchIcraTaksitBody,
  req: Request
): Promise<Record<string, unknown>> {
  const meta = getRequestMeta(req)
  const taksit = await assertTaksitForTenant(tenantId, taksitId)
  if (taksit.alacak.durum === DurumEnum.IPTAL) {
    throw new AppError(400, 'İptal edilmiş alacak için taksit düzenlenemez.', 'INVALID_STATE')
  }

  const odenen = taksit.odemeler.reduce((s, o) => s + num(o.tutar), 0)
  const mevcutTutar = num(taksit.tutar)
  const yeniTutar = body.tutar !== undefined ? body.tutar : mevcutTutar

  if (odenen >= mevcutTutar - 0.001 && body.tutar !== undefined && Math.abs(body.tutar - mevcutTutar) > 0.001) {
    throw new AppError(400, 'Tam ödenmiş taksitte tutar değiştirilemez.', 'INVALID_STATE')
  }
  if (odenen > 0 && yeniTutar < odenen - 0.001) {
    throw new AppError(400, 'Yeni taksit tutarı ödenen tutardan küçük olamaz.', 'INVALID_STATE')
  }

  await prisma.icraTahsilatTaksit.update({
    where: { id: taksitId },
    data: {
      ...(body.vadeTarihi ? { vadeTarihi: body.vadeTarihi } : {}),
      ...(body.tutar !== undefined ? { tutar: new PrismaNs.Decimal(body.tutar) } : {}),
      ...(body.aciklama !== undefined ? { aciklama: body.aciklama?.trim() || null } : {})
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'ICRA_TAHSILAT_TAKSIT_UPDATED',
    entityType: 'IcraTahsilatTaksit',
    entityId: taksitId,
    newValue: body,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getIcraTahsilatById(tenantId, taksit.alacakId)
}

export async function deleteIcraTahsilatTaksit(
  tenantId: string,
  userId: string,
  taksitId: string,
  req: Request
): Promise<Record<string, unknown>> {
  const meta = getRequestMeta(req)
  const taksit = await assertTaksitForTenant(tenantId, taksitId)
  if (taksit.odemeler.length > 0) {
    throw new AppError(400, 'Ödeme kaydı olan taksit silinemez.', 'INVALID_STATE')
  }
  const alacakId = taksit.alacakId
  await prisma.icraTahsilatTaksit.delete({ where: { id: taksitId } })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'ICRA_TAHSILAT_TAKSIT_DELETED',
    entityType: 'IcraTahsilatTaksit',
    entityId: taksitId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getIcraTahsilatById(tenantId, alacakId)
}

export async function createIcraTaksitOdeme(
  tenantId: string,
  userId: string,
  actorRole: UserRole,
  alacakId: string,
  taksitId: string,
  body: CreateIcraTaksitOdemeBody,
  req: Request
): Promise<Record<string, unknown>> {
  const meta = getRequestMeta(req)
  const alacak = await assertAlacakForTenant(tenantId, alacakId)
  if (alacak.durum === DurumEnum.IPTAL) {
    throw new AppError(400, 'İptal edilmiş alacak için ödeme alınamaz.', 'INVALID_STATE')
  }

  const taksit = await assertTaksitForTenant(tenantId, taksitId)
  if (taksit.alacakId !== alacakId) {
    throw new AppError(400, 'Taksit bu alacağa ait değil.', 'INVALID_STATE')
  }

  const odenen = taksit.odemeler.reduce((s, o) => s + num(o.tutar), 0)
  const kalan = Math.max(0, num(taksit.tutar) - odenen)
  if (body.tutar > kalan + 0.001) {
    throw new AppError(400, 'Ödeme tutarı kalan taksit tutarını aşamaz.', 'INVALID_STATE')
  }

  const tahsilati = await resolveTahsilatiYapanPersonel(
    tenantId,
    userId,
    actorRole,
    body.tahsilatiYapanPersonelId ?? body.tahsilatiYapanUserId
  )

  await prisma.$transaction(async (tx) => {
    await icraOdemeKaydetInTx(tx, {
      tenantId,
      userId,
      actorRole,
      alacak,
      taksitId,
      taksitNo: taksit.taksitNo,
      tutar: new PrismaNs.Decimal(body.tutar),
      odemeTarihi: body.odemeTarihi,
      odemeYontemi: body.odemeYontemi,
      aciklama: body.aciklama?.trim() || null,
      pesinatMi: false,
      tahsilatiYapanPersonelId: tahsilati.personelId,
      tahsilatiYapanUserId: tahsilati.bagliUserId
    })
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'ICRA_TAHSILAT_ODEME_CREATED',
    entityType: 'IcraTahsilatOdeme',
    entityId: taksitId,
    newValue: { tutar: body.tutar, taksitId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getIcraTahsilatById(tenantId, alacakId)
}

export async function listIcraTaksitOdemeler(
  tenantId: string,
  alacakId: string,
  taksitId: string
): Promise<Record<string, unknown>[]> {
  await assertAlacakForTenant(tenantId, alacakId)
  const taksit = await assertTaksitForTenant(tenantId, taksitId)
  if (taksit.alacakId !== alacakId) {
    throw new AppError(400, 'Taksit bu alacağa ait değil.', 'INVALID_STATE')
  }
  const rows = await prisma.icraTahsilatOdeme.findMany({
    where: { tenantId, taksitId },
    orderBy: [{ odemeTarihi: 'desc' }, { createdAt: 'desc' }],
    include: odemeCollectorInclude
  })
  return rows.map(serializeOdeme)
}

export async function markIcraTahsilatOdemeSmm(
  tenantId: string,
  userId: string,
  odemeId: string,
  req: Request
): Promise<Record<string, unknown>> {
  const meta = getRequestMeta(req)
  const odeme = await prisma.icraTahsilatOdeme.findFirst({ where: { id: odemeId, tenantId } })
  if (!odeme) throw new AppError(404, 'Ödeme kaydı bulunamadı.', 'NOT_FOUND')
  if (odeme.smmKesildiMi) {
    throw new AppError(400, 'SMM zaten kesildi.', 'INVALID_STATE')
  }

  const updated = await prisma.icraTahsilatOdeme.update({
    where: { id: odemeId },
    data: { smmKesildiMi: true }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'ICRA_TAHSILAT_SMM_KESILDI',
    entityType: 'IcraTahsilatOdeme',
    entityId: odemeId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeOdeme(updated)
}
