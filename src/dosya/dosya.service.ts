import type { Dosya, Muvekkil, Prisma } from '@prisma/client'
import { KasaHareketTipi, KasaOnayDurumu } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import { getMuvekkilById, serializeMuvekkil } from '../muvekkil/muvekkil.service.js'
import { serializeTenant } from '../auth/auth.service.js'
import { getKasaOzet, listAllKasaHareketleriForDosya, serializeKasaHareketi } from '../kasa/kasa.service.js'
import { getDosyaVekaletPackage } from '../vekalet/vekalet.service.js'
import type { CreateDosyaBody, ListDosyaForMuvekkilQuery, UpdateDosyaBody } from './dosya.schemas.js'

export function serializeDosya(d: Dosya): Record<string, unknown> {
  return {
    id: d.id,
    tenantId: d.tenantId,
    muvekkilId: d.muvekkilId,
    konuBasligi: d.konuBasligi,
    mahkeme: d.mahkeme,
    icraDairesi: d.icraDairesi,
    dosyaNo: d.dosyaNo,
    dosyaTuru: d.dosyaTuru,
    durum: d.durum,
    aciklama: d.aciklama,
    aktifMi: d.aktifMi,
    createdById: d.createdById,
    updatedById: d.updatedById,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString()
  }
}

function buildDosyaUncheckedFields(body: CreateDosyaBody): Omit<Prisma.DosyaUncheckedCreateInput, 'tenantId' | 'muvekkilId' | 'createdById'> {
  return {
    konuBasligi: body.konuBasligi.trim(),
    mahkeme: body.mahkeme,
    icraDairesi: body.icraDairesi,
    dosyaNo: body.dosyaNo,
    dosyaTuru: body.dosyaTuru,
    durum: body.durum,
    aciklama: body.aciklama,
    aktifMi: true
  }
}

function buildDosyaUpdateFields(body: UpdateDosyaBody): Prisma.DosyaUncheckedUpdateInput {
  return {
    konuBasligi: body.konuBasligi.trim(),
    mahkeme: body.mahkeme,
    icraDairesi: body.icraDairesi,
    dosyaNo: body.dosyaNo,
    dosyaTuru: body.dosyaTuru,
    durum: body.durum,
    aciklama: body.aciklama
  }
}

export async function listDosyalarForMuvekkil(
  tenantId: string,
  muvekkilId: string,
  query: ListDosyaForMuvekkilQuery
): Promise<{ items: Dosya[]; total: number } | null> {
  const mu = await getMuvekkilById(tenantId, muvekkilId)
  if (!mu) return null

  const { q, durum, dosyaTuru, page, limit } = query
  const skip = (page - 1) * limit

  const where: Prisma.DosyaWhereInput = {
    tenantId,
    muvekkilId,
    aktifMi: true,
    ...(durum ? { durum } : {}),
    ...(dosyaTuru ? { dosyaTuru } : {}),
    ...(q.length > 0
      ? {
          OR: [
            { konuBasligi: { contains: q, mode: 'insensitive' } },
            { mahkeme: { contains: q, mode: 'insensitive' } },
            { icraDairesi: { contains: q, mode: 'insensitive' } },
            { dosyaNo: { contains: q, mode: 'insensitive' } },
            { aciklama: { contains: q, mode: 'insensitive' } }
          ]
        }
      : {})
  }

  const [total, items] = await prisma.$transaction([
    prisma.dosya.count({ where }),
    prisma.dosya.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      skip,
      take: limit
    })
  ])

  return { items, total }
}

export async function createDosya(
  tenantId: string,
  userId: string,
  muvekkilId: string,
  body: CreateDosyaBody,
  req: Request
): Promise<Dosya> {
  const meta = getRequestMeta(req)
  const mu = await getMuvekkilById(tenantId, muvekkilId)
  if (!mu) {
    throw new AppError(404, 'Müvekkil bulunamadı.', 'NOT_FOUND')
  }

  const data = buildDosyaUncheckedFields(body)

  const created = await prisma.dosya.create({
    data: {
      ...data,
      tenantId,
      muvekkilId,
      createdById: userId
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'DOSYA_CREATED',
    entityType: 'Dosya',
    entityId: created.id,
    newValue: serializeDosya(created),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return created
}

export type DosyaWithMuvekkil = { dosya: Dosya; muvekkil: Muvekkil }

export async function getDosyaWithMuvekkilForTenant(tenantId: string, dosyaId: string): Promise<DosyaWithMuvekkil | null> {
  const row = await prisma.dosya.findFirst({
    where: { id: dosyaId, tenantId, aktifMi: true },
    include: { muvekkil: true }
  })
  if (!row) return null
  if (!row.muvekkil.aktifMi) return null
  const { muvekkil, ...dosya } = row
  return { dosya, muvekkil }
}

export async function updateDosya(
  tenantId: string,
  userId: string,
  dosyaId: string,
  body: UpdateDosyaBody,
  req: Request
): Promise<Dosya> {
  const meta = getRequestMeta(req)
  const existing = await prisma.dosya.findFirst({
    where: { id: dosyaId, tenantId, aktifMi: true }
  })
  if (!existing) {
    throw new AppError(404, 'Dosya bulunamadı.', 'NOT_FOUND')
  }

  const data = buildDosyaUpdateFields(body)

  const updated = await prisma.dosya.update({
    where: { id: dosyaId },
    data: {
      ...data,
      updatedById: userId
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'DOSYA_UPDATED',
    entityType: 'Dosya',
    entityId: dosyaId,
    oldValue: serializeDosya(existing),
    newValue: serializeDosya(updated),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return updated
}

export async function deactivateDosya(tenantId: string, userId: string, dosyaId: string, req: Request): Promise<void> {
  const meta = getRequestMeta(req)
  const existing = await prisma.dosya.findFirst({
    where: { id: dosyaId, tenantId, aktifMi: true }
  })
  if (!existing) {
    throw new AppError(404, 'Dosya bulunamadı.', 'NOT_FOUND')
  }

  await prisma.dosya.update({
    where: { id: dosyaId },
    data: { aktifMi: false, updatedById: userId }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'DOSYA_DEACTIVATED',
    entityType: 'Dosya',
    entityId: dosyaId,
    oldValue: { aktifMi: true },
    newValue: { aktifMi: false },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
}

/** Dosya hesap özeti: tenant + dosya + müvekkil + kasa + vekalet (tek istek). */
export async function getDosyaHesapOzetiForTenant(
  tenantId: string,
  dosyaId: string
): Promise<Record<string, unknown> | null> {
  const row = await getDosyaWithMuvekkilForTenant(tenantId, dosyaId)
  if (!row) return null

  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, aktifMi: true } })
  if (!tenant) return null

  const [kasaOzet, kasaItems, vekaletPack] = await Promise.all([
    getKasaOzet(tenantId, dosyaId),
    listAllKasaHareketleriForDosya(tenantId, dosyaId),
    getDosyaVekaletPackage(tenantId, dosyaId)
  ])

  if (!kasaOzet || !kasaItems || !vekaletPack) return null

  const yazdirmaTarihi = new Date().toISOString()

  return {
    tenant: serializeTenant(tenant),
    dosya: serializeDosya(row.dosya),
    muvekkil: serializeMuvekkil(row.muvekkil),
    kasaOzet,
    kasaHareketleri: kasaItems.map((h) => serializeKasaHareketi(h)),
    vekalet: {
      ucret: vekaletPack.vekaletUcreti,
      ozet: vekaletPack.ozet
    },
    taksitler: vekaletPack.taksitler,
    smmBekleyenler: vekaletPack.smmBekleyen,
    yazdirmaTarihi
  }
}

/** Makbuz listesi: onaylı avans + ödenmiş vekalet taksitleri (tenant güvenli). */
export async function getDosyaMakbuzlariForTenant(
  tenantId: string,
  dosyaId: string
): Promise<{ avansMakbuzlari: Record<string, unknown>[]; vekaletMakbuzlari: Record<string, unknown>[] } | null> {
  const row = await getDosyaWithMuvekkilForTenant(tenantId, dosyaId)
  if (!row) return null

  const items = await listAllKasaHareketleriForDosya(tenantId, dosyaId)
  if (!items) return null

  const pack = await getDosyaVekaletPackage(tenantId, dosyaId)
  if (!pack) return null

  const avansMakbuzlari = items
    .filter((h) => h.tip === KasaHareketTipi.AVANS_GIRISI && h.onayDurumu === KasaOnayDurumu.ONAYLI)
    .map((h) => {
      const s = serializeKasaHareketi(h)
      return {
        id: s.id,
        tarih: s.tarih,
        belgeNo: s.belgeNo,
        tutar: s.tutar,
        aciklama: s.aciklama,
        makbuzNo: s.belgeNo
      }
    })

  const odemeler = await prisma.vekaletTaksitOdeme.findMany({
    where: { tenantId, dosyaId },
    orderBy: [{ odemeTarihi: 'desc' }, { createdAt: 'desc' }],
    include: { taksit: { select: { taksitNo: true } } }
  })

  const vekaletMakbuzlari = odemeler.map((o) => ({
    id: o.id,
    odemeId: o.id,
    taksitId: o.taksitId,
    taksitNo: o.taksit.taksitNo,
    odemeTarihi: o.odemeTarihi.toISOString(),
    makbuzNo: o.makbuzNo,
    tutar: o.tutar.toFixed(2),
    smmKesildiMi: o.smmKesildiMi
  }))

  return { avansMakbuzlari, vekaletMakbuzlari }
}
