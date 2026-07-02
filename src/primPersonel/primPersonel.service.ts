import type { PrimPersonel, Prisma, UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import type { CreatePrimPersonelBody, ListPrimPersonelQuery, UpdatePrimPersonelBody } from './primPersonel.schemas.js'

const YONETICI_ROLLER: UserRole[] = ['BURO_SAHIBI', 'AVUKAT_YONETICI']

function isYonetici(role: UserRole): boolean {
  return YONETICI_ROLLER.includes(role)
}

export function serializePrimPersonel(p: PrimPersonel & { bagliUser?: { id: string; adSoyad: string } | null }) {
  return {
    id: p.id,
    tenantId: p.tenantId,
    adSoyad: p.adSoyad,
    telefon: p.telefon,
    eposta: p.eposta,
    unvan: p.unvan,
    aktifMi: p.aktifMi,
    not: p.not,
    bagliUserId: p.bagliUserId,
    bagliUserAdSoyad: p.bagliUser?.adSoyad ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString()
  }
}

async function assertBagliUser(tenantId: string, bagliUserId: string | null | undefined, exceptPersonelId?: string) {
  if (!bagliUserId) return
  const user = await prisma.user.findFirst({ where: { id: bagliUserId, tenantId, aktifMi: true } })
  if (!user) throw new AppError(400, 'Bağlanacak kullanıcı bulunamadı.', 'INVALID_USER')

  const existing = await prisma.primPersonel.findFirst({
    where: {
      tenantId,
      bagliUserId,
      ...(exceptPersonelId ? { id: { not: exceptPersonelId } } : {})
    }
  })
  if (existing) {
    throw new AppError(400, 'Bu kullanıcı zaten başka bir personele bağlı.', 'USER_ALREADY_LINKED')
  }
}

export async function listPrimPersoneller(
  tenantId: string,
  actorUserId: string,
  actorRole: UserRole,
  query: ListPrimPersonelQuery
) {
  const yonetici = isYonetici(actorRole)
  const { q, aktifMi, page, limit } = query
  const skip = (page - 1) * limit

  const where: Prisma.PrimPersonelWhereInput = {
    tenantId,
    ...(aktifMi !== undefined ? { aktifMi } : {}),
    ...(!yonetici ? { bagliUserId: actorUserId } : {}),
    ...(q
      ? {
          OR: [
            { adSoyad: { contains: q, mode: 'insensitive' } },
            { unvan: { contains: q, mode: 'insensitive' } },
            { telefon: { contains: q, mode: 'insensitive' } },
            { eposta: { contains: q, mode: 'insensitive' } }
          ]
        }
      : {})
  }

  const [total, items] = await prisma.$transaction([
    prisma.primPersonel.count({ where }),
    prisma.primPersonel.findMany({
      where,
      include: { bagliUser: { select: { id: true, adSoyad: true } } },
      orderBy: [{ aktifMi: 'desc' }, { adSoyad: 'asc' }],
      skip,
      take: limit
    })
  ])

  return { items: items.map(serializePrimPersonel), total, page, limit }
}

export async function getPrimPersonelForActor(
  tenantId: string,
  actorUserId: string,
  actorRole: UserRole,
  id: string
) {
  if (!isYonetici(actorRole)) {
    const row = await prisma.primPersonel.findFirst({ where: { id, tenantId, bagliUserId: actorUserId } })
    if (!row) throw new AppError(403, 'Bu personel kaydına erişim yok.', 'FORBIDDEN')
    return row
  }
  const row = await prisma.primPersonel.findFirst({ where: { id, tenantId } })
  if (!row) throw new AppError(404, 'Personel bulunamadı.', 'NOT_FOUND')
  return row
}

export async function createPrimPersonel(tenantId: string, body: CreatePrimPersonelBody) {
  await assertBagliUser(tenantId, body.bagliUserId ?? null)

  const dup = await prisma.primPersonel.findFirst({
    where: { tenantId, adSoyad: { equals: body.adSoyad.trim(), mode: 'insensitive' }, aktifMi: true }
  })

  const created = await prisma.primPersonel.create({
    data: {
      tenantId,
      adSoyad: body.adSoyad.trim(),
      telefon: body.telefon?.trim() || null,
      eposta: body.eposta?.trim() || null,
      unvan: body.unvan?.trim() || null,
      not: body.not?.trim() || null,
      bagliUserId: body.bagliUserId ?? null,
      aktifMi: body.aktifMi ?? true
    },
    include: { bagliUser: { select: { id: true, adSoyad: true } } }
  })

  return { personel: serializePrimPersonel(created), duplicateNameWarning: Boolean(dup) }
}

export async function updatePrimPersonel(tenantId: string, id: string, body: UpdatePrimPersonelBody) {
  const existing = await prisma.primPersonel.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'Personel bulunamadı.', 'NOT_FOUND')

  if (body.bagliUserId !== undefined) {
    await assertBagliUser(tenantId, body.bagliUserId, id)
  }

  const updated = await prisma.primPersonel.update({
    where: { id },
    data: {
      adSoyad: body.adSoyad?.trim(),
      telefon: body.telefon === undefined ? undefined : body.telefon?.trim() || null,
      eposta: body.eposta === undefined ? undefined : body.eposta?.trim() || null,
      unvan: body.unvan === undefined ? undefined : body.unvan?.trim() || null,
      not: body.not === undefined ? undefined : body.not?.trim() || null,
      bagliUserId: body.bagliUserId === undefined ? undefined : body.bagliUserId,
      aktifMi: body.aktifMi
    },
    include: { bagliUser: { select: { id: true, adSoyad: true } } }
  })

  return serializePrimPersonel(updated)
}

export async function listActivePrimPersonelForSelect(tenantId: string) {
  const rows = await prisma.primPersonel.findMany({
    where: { tenantId, aktifMi: true },
    include: { bagliUser: { select: { id: true, adSoyad: true } } },
    orderBy: { adSoyad: 'asc' }
  })
  return rows.map(serializePrimPersonel)
}

export async function getLinkedPrimPersonelForUser(tenantId: string, userId: string) {
  const row = await prisma.primPersonel.findFirst({
    where: { tenantId, bagliUserId: userId, aktifMi: true },
    include: { bagliUser: { select: { id: true, adSoyad: true } } }
  })
  return row ? serializePrimPersonel(row) : null
}

export async function listLinkKullanicilarForPrimPersonel(
  tenantId: string,
  exceptPersonelId?: string
) {
  const bagliPersoneller = await prisma.primPersonel.findMany({
    where: {
      tenantId,
      bagliUserId: { not: null },
      ...(exceptPersonelId ? { id: { not: exceptPersonelId } } : {})
    },
    select: { bagliUserId: true, adSoyad: true }
  })
  const bagliMap = new Map(
    bagliPersoneller
      .filter((p): p is { bagliUserId: string; adSoyad: string } => p.bagliUserId != null)
      .map((p) => [p.bagliUserId, p.adSoyad])
  )

  const users = await prisma.user.findMany({
    where: { tenantId, aktifMi: true },
    select: {
      id: true,
      adSoyad: true,
      kullaniciAdi: true,
      eposta: true,
      telefon: true,
      role: true,
      aktifMi: true
    },
    orderBy: { adSoyad: 'asc' }
  })

  return users.map((u) => ({
    id: u.id,
    adSoyad: u.adSoyad,
    kullaniciAdi: u.kullaniciAdi,
    eposta: u.eposta,
    telefon: u.telefon,
    role: u.role,
    aktifMi: u.aktifMi,
    baskaPersoneleBagli: bagliMap.has(u.id),
    bagliPersonelAdSoyad: bagliMap.get(u.id) ?? null
  }))
}
