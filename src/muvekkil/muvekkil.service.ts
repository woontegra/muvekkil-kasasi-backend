import type { Muvekkil, Prisma } from '@prisma/client'
import { MuvekkilTur } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import type { CreateMuvekkilBody, ListMuvekkilQuery } from './muvekkil.schemas.js'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'

export function computeGorunenAd(tur: MuvekkilTur, adSoyad: string, sirketUnvani: string | null): string {
  if (tur === MuvekkilTur.TUZEL) return (sirketUnvani ?? '').trim()
  return adSoyad.trim()
}

export function serializeMuvekkil(m: Muvekkil): Record<string, unknown> {
  return {
    id: m.id,
    tenantId: m.tenantId,
    tur: m.tur,
    gorunenAd: m.gorunenAd,
    adSoyad: m.adSoyad,
    sirketUnvani: m.sirketUnvani,
    telefon: m.telefon,
    eposta: m.eposta,
    adres: m.adres,
    not: m.notMetni,
    yetkiliAdSoyad: m.yetkiliAdSoyad,
    yetkiliTelefon: m.yetkiliTelefon,
    mudurAdSoyad: m.mudurAdSoyad,
    mudurTelefon: m.mudurTelefon,
    muhasebeAdSoyad: m.muhasebeAdSoyad,
    muhasebeTelefon: m.muhasebeTelefon,
    aktifMi: m.aktifMi,
    createdById: m.createdById,
    updatedById: m.updatedById,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString()
  }
}

function buildMuvekkilUncheckedFields(body: CreateMuvekkilBody): Omit<Prisma.MuvekkilUncheckedCreateInput, 'tenantId' | 'createdById'> {
  const gorunenAd = computeGorunenAd(body.tur, body.adSoyad, body.sirketUnvani ?? null)
  return {
    tur: body.tur,
    gorunenAd,
    adSoyad: body.adSoyad.trim(),
    sirketUnvani: body.sirketUnvani,
    telefon: body.telefon.trim() || null,
    eposta: body.eposta,
    adres: body.adres,
    notMetni: body.not,
    yetkiliAdSoyad: body.yetkiliAdSoyad.trim(),
    yetkiliTelefon: body.yetkiliTelefon.trim(),
    mudurAdSoyad: body.mudurAdSoyad.trim(),
    mudurTelefon: body.mudurTelefon.trim(),
    muhasebeAdSoyad: body.muhasebeAdSoyad.trim(),
    muhasebeTelefon: body.muhasebeTelefon.trim(),
    aktifMi: true
  }
}

export async function listMuvekkiller(tenantId: string, query: ListMuvekkilQuery): Promise<{ items: Muvekkil[]; total: number }> {
  const { q, tur, page, limit } = query
  const skip = (page - 1) * limit

  const where: Prisma.MuvekkilWhereInput = {
    tenantId,
    aktifMi: true,
    ...(tur ? { tur } : {}),
    ...(q.length > 0
      ? {
          OR: [
            { gorunenAd: { contains: q, mode: 'insensitive' } },
            { adSoyad: { contains: q, mode: 'insensitive' } },
            { sirketUnvani: { contains: q, mode: 'insensitive' } },
            { telefon: { contains: q, mode: 'insensitive' } },
            { eposta: { contains: q, mode: 'insensitive' } },
            { adres: { contains: q, mode: 'insensitive' } }
          ]
        }
      : {})
  }

  const [total, items] = await prisma.$transaction([
    prisma.muvekkil.count({ where }),
    prisma.muvekkil.findMany({
      where,
      orderBy: [{ gorunenAd: 'asc' }],
      skip,
      take: limit
    })
  ])

  return { items, total }
}

export async function getMuvekkilById(tenantId: string, id: string): Promise<Muvekkil | null> {
  return prisma.muvekkil.findFirst({
    where: { id, tenantId, aktifMi: true }
  })
}

export async function createMuvekkil(
  tenantId: string,
  userId: string,
  body: CreateMuvekkilBody,
  req: Request
): Promise<Muvekkil> {
  const meta = getRequestMeta(req)
  const data = buildMuvekkilUncheckedFields(body)

  const created = await prisma.muvekkil.create({
    data: {
      ...data,
      tenantId,
      createdById: userId
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'MUVEKKIL_CREATED',
    entityType: 'Muvekkil',
    entityId: created.id,
    newValue: serializeMuvekkil(created),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return created
}

export async function updateMuvekkil(
  tenantId: string,
  userId: string,
  id: string,
  body: CreateMuvekkilBody,
  req: Request
): Promise<Muvekkil> {
  const meta = getRequestMeta(req)
  const existing = await prisma.muvekkil.findFirst({ where: { id, tenantId, aktifMi: true } })
  if (!existing) {
    throw new AppError(404, 'Müvekkil bulunamadı.', 'NOT_FOUND')
  }

  const data = buildMuvekkilUncheckedFields(body)

  const updated = await prisma.muvekkil.update({
    where: { id },
    data: {
      ...data,
      updatedById: userId
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'MUVEKKIL_UPDATED',
    entityType: 'Muvekkil',
    entityId: id,
    oldValue: serializeMuvekkil(existing),
    newValue: serializeMuvekkil(updated),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return updated
}

export async function deactivateMuvekkil(tenantId: string, userId: string, id: string, req: Request): Promise<void> {
  const meta = getRequestMeta(req)
  const existing = await prisma.muvekkil.findFirst({ where: { id, tenantId, aktifMi: true } })
  if (!existing) {
    throw new AppError(404, 'Müvekkil bulunamadı.', 'NOT_FOUND')
  }

  await prisma.muvekkil.update({
    where: { id },
    data: { aktifMi: false, updatedById: userId }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'MUVEKKIL_DEACTIVATED',
    entityType: 'Muvekkil',
    entityId: id,
    oldValue: { aktifMi: true },
    newValue: { aktifMi: false },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
}
