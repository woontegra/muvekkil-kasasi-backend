import type { OfisKasaHareketi, Prisma } from '@prisma/client'
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
  CreateOfisKasaDuzeltmeBody,
  CreateOfisKasaHareketiBody,
  ListOfisKasaHareketleriQuery
} from './ofisKasa.schemas.js'
import { isDigerGelir, isDigerGider } from './ofisKasa.schemas.js'

export const OFIS_KASA_DUZELTME_KATEGORI = 'Düzeltme'

export type OfisKasaHareketiWithOrijinal = OfisKasaHareketi & {
  orijinalHareket?: { id: string; belgeNo: string } | null
}

function decimalToString(d: Prisma.Decimal): string {
  return d.toFixed(2)
}

export function serializeOfisKasaHareketi(h: OfisKasaHareketiWithOrijinal): Record<string, unknown> {
  return {
    id: h.id,
    tenantId: h.tenantId,
    islemTipi: h.islemTipi,
    tarih: h.tarih.toISOString(),
    kategori: h.kategori,
    ozelKategoriAdi: h.ozelKategoriAdi,
    aciklama: h.aciklama,
    tutar: decimalToString(h.tutar),
    odemeYontemi: h.odemeYontemi,
    belgeNo: h.belgeNo,
    onayDurumu: h.onayDurumu,
    onaylayanId: h.onaylayanId,
    onayTarihi: h.onayTarihi?.toISOString() ?? null,
    redSebebi: h.redSebebi,
    orijinalHareketId: h.orijinalHareketId,
    orijinalBelgeNo: h.orijinalHareket?.belgeNo ?? null,
    otomatikOnayMi: h.otomatikOnayMi,
    createdById: h.createdById,
    updatedById: h.updatedById,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString()
  }
}

async function nextBelgeNo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  tip: OfisKasaIslemTipi,
  tarih: Date
): Promise<string> {
  const year = tarih.getFullYear()
  const p =
    tip === OfisKasaIslemTipi.GELIR ? 'OFG' : tip === OfisKasaIslemTipi.GIDER ? 'OFD' : 'OFDZT'
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
    where: { id, tenantId }
  })
}

export async function listOfisKasaHareketleri(
  tenantId: string,
  query: ListOfisKasaHareketleriQuery
): Promise<{ items: OfisKasaHareketiWithOrijinal[]; total: number }> {
  const { q, islemTipi, onayDurumu, kategori, startDate, endDate, page, limit } = query
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
    ...(islemTipi ? { islemTipi } : {}),
    ...(onayDurumu ? { onayDurumu } : {}),
    ...(kategori ? { kategori } : {}),
    ...(tarihFilter ? { tarih: tarihFilter } : {}),
    ...(q.length > 0
      ? {
          OR: [
            { belgeNo: { contains: q, mode: 'insensitive' } },
            { aciklama: { contains: q, mode: 'insensitive' } },
            { kategori: { contains: q, mode: 'insensitive' } },
            { ozelKategoriAdi: { contains: q, mode: 'insensitive' } }
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
      include: {
        orijinalHareket: { select: { id: true, belgeNo: true } }
      }
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

async function sumApprovedByTip(
  tenantId: string,
  tip: OfisKasaIslemTipi,
  tarih?: Prisma.DateTimeFilter
): Promise<number> {
  const r = await prisma.ofisKasaHareketi.aggregate({
    where: {
      tenantId,
      onayDurumu: OfisKasaOnayDurumu.ONAYLI,
      islemTipi: tip,
      ...(tarih ? { tarih } : {})
    },
    _sum: { tutar: true }
  })
  return Number(r._sum.tutar ?? 0)
}

export async function getOfisKasaOzet(tenantId: string): Promise<{
  toplamGelir: string
  toplamGider: string
  toplamDuzeltme: string
  kasaBakiyesi: string
  onaysizIslemSayisi: number
  buAyGelir: string
  buAyGider: string
}> {
  const gelir = await sumApprovedByTip(tenantId, OfisKasaIslemTipi.GELIR)
  const gider = await sumApprovedByTip(tenantId, OfisKasaIslemTipi.GIDER)
  const duzeltme = await sumApprovedByTip(tenantId, OfisKasaIslemTipi.DUZELTME)
  const kasa = gelir - gider + duzeltme

  const { start, end } = monthRangeLocal(new Date())
  const tarihAy: Prisma.DateTimeFilter = { gte: start, lte: end }
  const buAyGelir = await sumApprovedByTip(tenantId, OfisKasaIslemTipi.GELIR, tarihAy)
  const buAyGider = await sumApprovedByTip(tenantId, OfisKasaIslemTipi.GIDER, tarihAy)

  const onaysizIslemSayisi = await prisma.ofisKasaHareketi.count({
    where: { tenantId, onayDurumu: OfisKasaOnayDurumu.ONAYSIZ }
  })

  const f = (n: number) => n.toFixed(2)
  return {
    toplamGelir: f(gelir),
    toplamGider: f(gider),
    toplamDuzeltme: f(duzeltme),
    kasaBakiyesi: f(kasa),
    onaysizIslemSayisi,
    buAyGelir: f(buAyGelir),
    buAyGider: f(buAyGider)
  }
}

export async function createOfisKasaHareketi(
  tenantId: string,
  userId: string,
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
            odemeYontemi: body.odemeYontemi,
            belgeNo,
            onayDurumu: OfisKasaOnayDurumu.ONAYSIZ,
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

export async function deleteOfisKasaHareketi(tenantId: string, userId: string, id: string, req: Request): Promise<void> {
  const meta = getRequestMeta(req)
  const row = await assertOfisKasaHareketiForTenant(tenantId, id)
  if (!row) {
    throw new AppError(404, 'Ofis kasa hareketi bulunamadı.', 'NOT_FOUND')
  }
  if (row.onayDurumu !== OfisKasaOnayDurumu.ONAYSIZ) {
    throw new AppError(400, 'Onaylı veya reddedilmiş kayıt silinemez.', 'INVALID_STATE')
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
