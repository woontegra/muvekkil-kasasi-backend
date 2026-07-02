import type { Dosya, KasaHareketi, Prisma, UserRole } from '@prisma/client'
import { KasaHareketTipi, KasaOnayDurumu, Prisma as PrismaClient } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import type { CreateDuzeltmeBody, CreateKasaHareketiBody, ListKasaHareketleriQuery } from './kasa.schemas.js'
import { isDigerMasraf } from './kasa.schemas.js'
import { resolveTahsilatiYapanPersonel } from '../lib/tahsilatiYapanPersonel.js'

export type KasaHareketiWithOrijinal = KasaHareketi & {
  orijinalHareket?: { id: string; belgeNo: string } | null
}

function decimalToString(d: Prisma.Decimal): string {
  return d.toFixed(2)
}

export function serializeKasaHareketi(h: KasaHareketiWithOrijinal): Record<string, unknown> {
  return {
    id: h.id,
    tenantId: h.tenantId,
    dosyaId: h.dosyaId,
    muvekkilId: h.muvekkilId,
    tip: h.tip,
    tarih: h.tarih.toISOString(),
    masrafTuru: h.masrafTuru,
    ozelMasrafAdi: h.ozelMasrafAdi,
    aciklama: h.aciklama,
    tutar: decimalToString(h.tutar),
    odemeYontemi: h.odemeYontemi,
    masrafiYapanKisi: h.masrafiYapanKisi,
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
    createdById: h.createdById,
    updatedById: h.updatedById,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString()
  }
}

async function nextBelgeNo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  tip: KasaHareketTipi,
  tarih: Date
): Promise<string> {
  const year = tarih.getFullYear()
  const p =
    tip === KasaHareketTipi.AVANS_GIRISI ? 'AVN' : tip === KasaHareketTipi.MASRAF ? 'MSF' : 'DZT'
  const prefix = `${p}-${year}-`
  const last = await tx.kasaHareketi.findFirst({
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

export async function assertDosyaForKasa(
  tenantId: string,
  dosyaId: string
): Promise<(Dosya & { muvekkilId: string }) | null> {
  return prisma.dosya.findFirst({
    where: { id: dosyaId, tenantId, aktifMi: true }
  })
}

export async function assertKasaHareketiForTenant(
  tenantId: string,
  id: string
): Promise<KasaHareketi | null> {
  return prisma.kasaHareketi.findFirst({
    where: { id, tenantId }
  })
}

async function buildKasaSearchOr(tenantId: string, dosyaId: string, q: string): Promise<Prisma.KasaHareketiWhereInput['OR']> {
  const or: Prisma.KasaHareketiWhereInput[] = [
    { belgeNo: { contains: q, mode: 'insensitive' } },
    { aciklama: { contains: q, mode: 'insensitive' } },
    { masrafTuru: { contains: q, mode: 'insensitive' } },
    { ozelMasrafAdi: { contains: q, mode: 'insensitive' } },
    { masrafiYapanKisi: { contains: q, mode: 'insensitive' } }
  ]

  const tipMap: Record<string, KasaHareketTipi> = {
    avans: KasaHareketTipi.AVANS_GIRISI,
    masraf: KasaHareketTipi.MASRAF,
    duzeltme: KasaHareketTipi.DUZELTME,
    vekalet: KasaHareketTipi.VEKALET_TAHSILAT,
    tahsilat: KasaHareketTipi.VEKALET_TAHSILAT
  }
  const tipKey = q.trim().toLowerCase()
  if (tipMap[tipKey]) or.push({ tip: tipMap[tipKey] })
  if (q.toUpperCase().includes('AVANS')) or.push({ tip: KasaHareketTipi.AVANS_GIRISI })
  if (q.toLowerCase().includes('vekalet')) or.push({ tip: KasaHareketTipi.VEKALET_TAHSILAT })
  if (q.toLowerCase().includes('masraf')) or.push({ tip: KasaHareketTipi.MASRAF })
  if (q.toLowerCase().includes('düzeltme') || q.toLowerCase().includes('duzeltme')) {
    or.push({ tip: KasaHareketTipi.DUZELTME })
  }

  const onayMap: Record<string, KasaOnayDurumu> = {
    onaysiz: KasaOnayDurumu.ONAYSIZ,
    onayli: KasaOnayDurumu.ONAYLI,
    onaylı: KasaOnayDurumu.ONAYLI,
    reddedildi: KasaOnayDurumu.REDDEDILDI
  }
  if (onayMap[tipKey]) or.push({ onayDurumu: onayMap[tipKey] })

  const odemeMap: Record<string, string> = {
    nakit: 'NAKIT',
    banka: 'BANKA',
    kredi: 'KREDI_KARTI',
    kart: 'KREDI_KARTI'
  }
  if (odemeMap[tipKey]) or.push({ odemeYontemi: odemeMap[tipKey] as Prisma.EnumOdemeYontemiFilter['equals'] })

  const amount = Number(q.replace(',', '.'))
  if (Number.isFinite(amount)) {
    or.push({ tutar: { equals: new PrismaClient.Decimal(amount.toFixed(2)) } })
  }

  const dateMatch = q.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (dateMatch) {
    const start = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T00:00:00.000Z`)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 1)
    or.push({ tarih: { gte: start, lt: end } })
  }

  const dmy = q.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/)
  if (dmy) {
    const start = new Date(`${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}T00:00:00.000Z`)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 1)
    or.push({ tarih: { gte: start, lt: end } })
  }

  const makbuzRows = await prisma.vekaletTaksitOdeme.findMany({
    where: { tenantId, dosyaId, makbuzNo: { contains: q, mode: 'insensitive' } },
    select: { kasaHareketId: true }
  })
  const kasaIds = makbuzRows.map((r) => r.kasaHareketId).filter((id): id is string => Boolean(id))
  if (kasaIds.length > 0) or.push({ id: { in: kasaIds } })

  return or
}

export async function listKasaHareketleri(
  tenantId: string,
  dosyaId: string,
  query: ListKasaHareketleriQuery
): Promise<{ items: KasaHareketiWithOrijinal[]; total: number } | null> {
  const dosya = await assertDosyaForKasa(tenantId, dosyaId)
  if (!dosya) return null

  const { q, tip, onayDurumu, page, limit } = query
  const skip = (page - 1) * limit

  const searchOr = q.length > 0 ? await buildKasaSearchOr(tenantId, dosyaId, q) : undefined

  const where: Prisma.KasaHareketiWhereInput = {
    tenantId,
    dosyaId,
    ...(tip ? { tip } : {}),
    ...(onayDurumu ? { onayDurumu } : {}),
    ...(searchOr && searchOr.length > 0 ? { OR: searchOr } : {})
  }

  const [total, items] = await prisma.$transaction([
    prisma.kasaHareketi.count({ where }),
    prisma.kasaHareketi.findMany({
      where,
      orderBy: [{ tarih: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
      include: {
        orijinalHareket: { select: { id: true, belgeNo: true } }
      }
    })
  ])

  return { items: items as KasaHareketiWithOrijinal[], total }
}

const HESAP_OZETI_KASA_LIMIT = 10_000

/** Dosya hesap özeti / makbuzlar için sayfalamasız liste (makul üst sınır). */
export async function listAllKasaHareketleriForDosya(
  tenantId: string,
  dosyaId: string
): Promise<KasaHareketiWithOrijinal[] | null> {
  const dosya = await assertDosyaForKasa(tenantId, dosyaId)
  if (!dosya) return null

  const items = await prisma.kasaHareketi.findMany({
    where: { tenantId, dosyaId },
    orderBy: [{ tarih: 'desc' }, { createdAt: 'desc' }],
    take: HESAP_OZETI_KASA_LIMIT,
    include: {
      orijinalHareket: { select: { id: true, belgeNo: true } }
    }
  })
  return items as KasaHareketiWithOrijinal[]
}

export async function getKasaOzet(tenantId: string, dosyaId: string): Promise<{
  toplamAvans: string
  toplamMasraf: string
  toplamDuzeltme: string
  bakiye: string
  onaysizIslemSayisi: number
} | null> {
  const dosya = await assertDosyaForKasa(tenantId, dosyaId)
  if (!dosya) return null

  const rows = await prisma.kasaHareketi.findMany({
    where: { tenantId, dosyaId, onayDurumu: KasaOnayDurumu.ONAYLI },
    select: { tip: true, tutar: true }
  })

  let avans = 0
  let masraf = 0
  let duzeltme = 0
  for (const r of rows) {
    const v = Number(r.tutar)
    if (r.tip === KasaHareketTipi.AVANS_GIRISI) avans += v
    else if (r.tip === KasaHareketTipi.MASRAF) masraf += v
    else if (r.tip === KasaHareketTipi.DUZELTME) duzeltme += v
    // VEKALET_TAHSILAT dosya kasası bakiyesine dahil edilmez
  }
  const bakiye = avans - masraf + duzeltme

  const onaysizIslemSayisi = await prisma.kasaHareketi.count({
    where: { tenantId, dosyaId, onayDurumu: KasaOnayDurumu.ONAYSIZ }
  })

  const f = (n: number) => n.toFixed(2)
  return {
    toplamAvans: f(avans),
    toplamMasraf: f(masraf),
    toplamDuzeltme: f(duzeltme),
    bakiye: f(bakiye),
    onaysizIslemSayisi
  }
}

export async function createKasaHareketi(
  tenantId: string,
  userId: string,
  actorRole: UserRole,
  dosyaId: string,
  body: CreateKasaHareketiBody,
  req: Request
): Promise<KasaHareketi> {
  const meta = getRequestMeta(req)
  const dosya = await assertDosyaForKasa(tenantId, dosyaId)
  if (!dosya) {
    throw new AppError(404, 'Dosya bulunamadı.', 'NOT_FOUND')
  }

  const masrafTuru =
    body.tip === KasaHareketTipi.MASRAF ? (body.masrafTuru?.trim() ?? null) : null
  const ozelMasrafAdi =
    body.tip === KasaHareketTipi.MASRAF && masrafTuru && isDigerMasraf(masrafTuru)
      ? body.ozelMasrafAdi?.trim() ?? null
      : null
  const masrafiYapanKisi =
    body.tip === KasaHareketTipi.MASRAF ? (body.masrafiYapanKisi?.trim() ?? null) : null

  const tutar = new PrismaClient.Decimal(body.tutar)

  const tahsilati =
    body.tip === KasaHareketTipi.AVANS_GIRISI
      ? await resolveTahsilatiYapanPersonel(tenantId, userId, actorRole, body.tahsilatiYapanPersonelId ?? body.tahsilatiYapanUserId)
      : null

  let attempts = 0
  while (attempts < 5) {
    attempts += 1
    try {
      const created = await prisma.$transaction(async (tx) => {
        const belgeNo = await nextBelgeNo(tx, tenantId, body.tip, body.tarih)
        return tx.kasaHareketi.create({
          data: {
            tenantId,
            dosyaId,
            muvekkilId: dosya.muvekkilId,
            tip: body.tip,
            tarih: body.tarih,
            masrafTuru,
            ozelMasrafAdi,
            aciklama: body.aciklama?.trim() || null,
            tutar,
            odemeYontemi: body.odemeYontemi ?? null,
            masrafiYapanKisi,
            belgeNo,
            onayDurumu: KasaOnayDurumu.ONAYSIZ,
            tahsilatiYapanPersonelId: tahsilati?.personelId ?? null,
            tahsilatiYapanUserId: tahsilati?.bagliUserId ?? null,
            createdById: userId
          }
        })
      })

      await writeAuditLog({
        tenantId,
        userId,
        action: 'KASA_HAREKETI_CREATED',
        entityType: 'KasaHareketi',
        entityId: created.id,
        newValue: serializeKasaHareketi({ ...created, orijinalHareket: null }),
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

export async function approveKasaHareketi(tenantId: string, userId: string, id: string, req: Request): Promise<KasaHareketi> {
  const meta = getRequestMeta(req)
  const row = await assertKasaHareketiForTenant(tenantId, id)
  if (!row) {
    throw new AppError(404, 'Kasa hareketi bulunamadı.', 'NOT_FOUND')
  }
  if (row.onayDurumu !== KasaOnayDurumu.ONAYSIZ) {
    throw new AppError(400, 'Yalnızca onaysız kayıt onaylanabilir.', 'INVALID_STATE')
  }

  const updated = await prisma.kasaHareketi.update({
    where: { id },
    data: {
      onayDurumu: KasaOnayDurumu.ONAYLI,
      onaylayanId: userId,
      onayTarihi: new Date(),
      redSebebi: null,
      updatedById: userId
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'KASA_HAREKETI_APPROVED',
    entityType: 'KasaHareketi',
    entityId: id,
    oldValue: { onayDurumu: KasaOnayDurumu.ONAYSIZ },
    newValue: { onayDurumu: KasaOnayDurumu.ONAYLI, onaylayanId: userId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return updated
}

export async function rejectKasaHareketi(
  tenantId: string,
  userId: string,
  id: string,
  redSebebi: string,
  req: Request
): Promise<KasaHareketi> {
  const meta = getRequestMeta(req)
  const row = await assertKasaHareketiForTenant(tenantId, id)
  if (!row) {
    throw new AppError(404, 'Kasa hareketi bulunamadı.', 'NOT_FOUND')
  }
  if (row.onayDurumu !== KasaOnayDurumu.ONAYSIZ) {
    throw new AppError(400, 'Yalnızca onaysız kayıt reddedilebilir.', 'INVALID_STATE')
  }

  const updated = await prisma.kasaHareketi.update({
    where: { id },
    data: {
      onayDurumu: KasaOnayDurumu.REDDEDILDI,
      redSebebi: redSebebi.trim(),
      updatedById: userId
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'KASA_HAREKETI_REJECTED',
    entityType: 'KasaHareketi',
    entityId: id,
    oldValue: { onayDurumu: KasaOnayDurumu.ONAYSIZ },
    newValue: { onayDurumu: KasaOnayDurumu.REDDEDILDI, redSebebi: redSebebi.trim() },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return updated
}

export async function createDuzeltmeKasa(
  tenantId: string,
  userId: string,
  orijinalId: string,
  body: CreateDuzeltmeBody,
  req: Request
): Promise<KasaHareketi> {
  const meta = getRequestMeta(req)
  const orijinal = await prisma.kasaHareketi.findFirst({
    where: { id: orijinalId, tenantId }
  })
  if (!orijinal) {
    throw new AppError(404, 'Kasa hareketi bulunamadı.', 'NOT_FOUND')
  }
  if (orijinal.onayDurumu !== KasaOnayDurumu.ONAYLI) {
    throw new AppError(400, 'Düzeltme yalnızca onaylı hareketler için oluşturulabilir.', 'INVALID_STATE')
  }
  if (orijinal.tip === KasaHareketTipi.DUZELTME) {
    throw new AppError(400, 'Düzeltme kaydına bağlı ikinci düzeltme bu uçtan açılamaz.', 'INVALID_STATE')
  }

  const dosya = await assertDosyaForKasa(tenantId, orijinal.dosyaId)
  if (!dosya) {
    throw new AppError(404, 'Dosya bulunamadı.', 'NOT_FOUND')
  }

  const tutar = new PrismaClient.Decimal(body.tutar)
  let attempts = 0
  while (attempts < 5) {
    attempts += 1
    try {
      const created = await prisma.$transaction(async (tx) => {
        const belgeNo = await nextBelgeNo(tx, tenantId, KasaHareketTipi.DUZELTME, body.tarih)
        return tx.kasaHareketi.create({
          data: {
            tenantId,
            dosyaId: orijinal.dosyaId,
            muvekkilId: orijinal.muvekkilId,
            tip: KasaHareketTipi.DUZELTME,
            tarih: body.tarih,
            masrafTuru: null,
            ozelMasrafAdi: null,
            aciklama: body.aciklama.trim(),
            tutar,
            odemeYontemi: null,
            masrafiYapanKisi: null,
            belgeNo,
            onayDurumu: KasaOnayDurumu.ONAYSIZ,
            orijinalHareketId: orijinal.id,
            createdById: userId
          }
        })
      })

      await writeAuditLog({
        tenantId,
        userId,
        action: 'KASA_DUZELTME_CREATED',
        entityType: 'KasaHareketi',
        entityId: created.id,
        newValue: {
          ...serializeKasaHareketi({ ...created, orijinalHareket: { id: orijinal.id, belgeNo: orijinal.belgeNo } }),
          orijinalHareketBelgeNo: orijinal.belgeNo
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

export async function deleteKasaHareketi(tenantId: string, userId: string, id: string, req: Request): Promise<void> {
  const meta = getRequestMeta(req)
  const row = await assertKasaHareketiForTenant(tenantId, id)
  if (!row) {
    throw new AppError(404, 'Kasa hareketi bulunamadı.', 'NOT_FOUND')
  }
  if (row.onayDurumu !== KasaOnayDurumu.ONAYSIZ) {
    throw new AppError(400, 'Onaylı veya reddedilmiş kayıt silinemez.', 'INVALID_STATE')
  }

  await prisma.kasaHareketi.delete({ where: { id } })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'KASA_HAREKETI_DELETED',
    entityType: 'KasaHareketi',
    entityId: id,
    oldValue: serializeKasaHareketi({ ...row, orijinalHareket: null }),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
}
