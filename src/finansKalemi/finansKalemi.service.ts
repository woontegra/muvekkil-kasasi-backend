import {
  FinansKalemTuru,
  Prisma,
  type PrismaClient,
  type TenantFinansKalemi
} from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { prisma } from '../lib/prisma.js'
import {
  buildTenantFinansKalemSeeds,
  isDigerGelirKalemAd,
  isDigerGiderKalemAd,
  normalizeFinansKalemAd
} from './finansKalemi.defaults.js'
import type {
  CreateFinansKalemiBody,
  ListFinansKalemleriQuery,
  ReorderFinansKalemleriBody,
  UpdateFinansKalemiBody
} from './finansKalemi.schemas.js'

export type FinansKalemiDto = {
  id: string
  tur: FinansKalemTuru
  kod: string | null
  ad: string
  aktif: boolean
  sistemMi: boolean
  sira: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export function toFinansKalemiDto(row: TenantFinansKalemi): FinansKalemiDto {
  return {
    id: row.id,
    tur: row.tur,
    kod: row.kod,
    ad: row.ad,
    aktif: row.aktif,
    sistemMi: row.sistemMi,
    sira: row.sira,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

type Tx = Prisma.TransactionClient | PrismaClient

export async function bootstrapTenantFinansKalemleri(
  tx: Tx,
  tenantId: string,
  createdById?: string | null
): Promise<number> {
  const seeds = buildTenantFinansKalemSeeds()
  let created = 0
  for (const seed of seeds) {
    const normalizeAd = normalizeFinansKalemAd(seed.ad)
    const existingByName = await tx.tenantFinansKalemi.findUnique({
      where: { tenantId_tur_normalizeAd: { tenantId, tur: seed.tur, normalizeAd } }
    })
    if (existingByName) continue
    if (seed.kod) {
      const existingByKod = await tx.tenantFinansKalemi.findFirst({
        where: { tenantId, kod: seed.kod }
      })
      if (existingByKod) continue
    }
    await tx.tenantFinansKalemi.create({
      data: {
        tenantId,
        tur: seed.tur,
        kod: seed.kod ?? null,
        ad: seed.ad,
        normalizeAd,
        aktif: true,
        sistemMi: seed.sistemMi,
        sira: seed.sira,
        createdById: createdById ?? null,
        updatedById: createdById ?? null
      }
    })
    created += 1
  }
  return created
}

export async function listFinansKalemleri(
  tenantId: string,
  query: ListFinansKalemleriQuery
): Promise<FinansKalemiDto[]> {
  const where: Prisma.TenantFinansKalemiWhereInput = {
    tenantId,
    ...(query.tur ? { tur: query.tur } : {}),
    ...(query.aktif === 'true' ? { aktif: true } : query.aktif === 'false' ? { aktif: false } : {}),
    ...(query.includeSistem ? {} : { sistemMi: false })
  }
  const rows = await prisma.tenantFinansKalemi.findMany({
    where,
    orderBy: [{ tur: 'asc' }, { sira: 'asc' }, { ad: 'asc' }]
  })
  return rows.map(toFinansKalemiDto)
}

export async function createFinansKalemi(
  tenantId: string,
  userId: string,
  body: CreateFinansKalemiBody
): Promise<{ item: FinansKalemiDto; reactivated: boolean }> {
  const ad = body.ad.trim().replace(/\s+/g, ' ')
  const normalizeAd = normalizeFinansKalemAd(ad)

  const existing = await prisma.tenantFinansKalemi.findUnique({
    where: { tenantId_tur_normalizeAd: { tenantId, tur: body.tur, normalizeAd } }
  })

  if (existing) {
    if (existing.sistemMi) {
      throw new AppError(409, 'Bu ad sistem kalemi ile çakışıyor.', 'FINANS_KALEM_SISTEM')
    }
    if (existing.aktif) {
      throw new AppError(409, 'Bu kalem zaten mevcut.', 'FINANS_KALEM_DUPLICATE')
    }
    throw new AppError(
      409,
      'Bu kalem daha önce kaldırılmış. Yeniden etkinleştirmek ister misiniz?',
      'FINANS_KALEM_ARCHIVED',
      { id: existing.id, ad: existing.ad, tur: existing.tur }
    )
  }

  const maxSira = await prisma.tenantFinansKalemi.aggregate({
    where: { tenantId, tur: body.tur, sistemMi: false },
    _max: { sira: true }
  })
  const sira = (maxSira._max.sira ?? 9) + 1

  const created = await prisma.tenantFinansKalemi.create({
    data: {
      tenantId,
      tur: body.tur,
      ad,
      normalizeAd,
      aktif: true,
      sistemMi: false,
      sira,
      createdById: userId,
      updatedById: userId
    }
  })
  return { item: toFinansKalemiDto(created), reactivated: false }
}

export async function updateFinansKalemi(
  tenantId: string,
  userId: string,
  id: string,
  body: UpdateFinansKalemiBody
): Promise<FinansKalemiDto> {
  const row = await assertTenantKalem(tenantId, id)
  if (row.sistemMi) {
    throw new AppError(403, 'Sistem kalemleri değiştirilemez.', 'FINANS_KALEM_SISTEM_LOCKED')
  }
  if (!body.ad && body.sira === undefined) {
    throw new AppError(400, 'Güncellenecek alan yok.', 'VALIDATION')
  }

  const data: Prisma.TenantFinansKalemiUpdateInput = { updatedBy: { connect: { id: userId } } }

  if (body.ad) {
    const ad = body.ad.trim().replace(/\s+/g, ' ')
    const normalizeAd = normalizeFinansKalemAd(ad)
    if (normalizeAd !== row.normalizeAd) {
      const clash = await prisma.tenantFinansKalemi.findUnique({
        where: { tenantId_tur_normalizeAd: { tenantId, tur: row.tur, normalizeAd } }
      })
      if (clash && clash.id !== row.id) {
        throw new AppError(409, 'Bu ad zaten kullanılıyor.', 'FINANS_KALEM_DUPLICATE')
      }
    }
    data.ad = ad
    data.normalizeAd = normalizeAd
  }
  if (body.sira !== undefined) {
    data.sira = body.sira
  }

  const updated = await prisma.tenantFinansKalemi.update({ where: { id: row.id }, data })
  return toFinansKalemiDto(updated)
}

export async function archiveFinansKalemi(
  tenantId: string,
  userId: string,
  id: string
): Promise<FinansKalemiDto> {
  const row = await assertTenantKalem(tenantId, id)
  if (row.sistemMi) {
    throw new AppError(403, 'Sistem kalemleri kaldırılamaz.', 'FINANS_KALEM_SISTEM_LOCKED')
  }
  if (!row.aktif) {
    return toFinansKalemiDto(row)
  }
  const updated = await prisma.tenantFinansKalemi.update({
    where: { id: row.id },
    data: {
      aktif: false,
      archivedAt: new Date(),
      updatedById: userId
    }
  })
  return toFinansKalemiDto(updated)
}

export async function activateFinansKalemi(
  tenantId: string,
  userId: string,
  id: string
): Promise<FinansKalemiDto> {
  const row = await assertTenantKalem(tenantId, id)
  if (row.sistemMi) {
    throw new AppError(403, 'Sistem kalemleri yönetilemez.', 'FINANS_KALEM_SISTEM_LOCKED')
  }
  if (row.aktif) {
    return toFinansKalemiDto(row)
  }
  const updated = await prisma.tenantFinansKalemi.update({
    where: { id: row.id },
    data: {
      aktif: true,
      archivedAt: null,
      updatedById: userId
    }
  })
  return toFinansKalemiDto(updated)
}

export async function reorderFinansKalemleri(
  tenantId: string,
  userId: string,
  body: ReorderFinansKalemleriBody
): Promise<FinansKalemiDto[]> {
  const rows = await prisma.tenantFinansKalemi.findMany({
    where: { tenantId, tur: body.tur, sistemMi: false },
    select: { id: true }
  })
  const allowed = new Set(rows.map((r) => r.id))
  for (const id of body.orderedIds) {
    if (!allowed.has(id)) {
      throw new AppError(400, 'Geçersiz kalem sırası.', 'FINANS_KALEM_REORDER')
    }
  }
  await prisma.$transaction(
    body.orderedIds.map((id, index) =>
      prisma.tenantFinansKalemi.update({
        where: { id },
        data: { sira: index + 10, updatedById: userId }
      })
    )
  )
  return listFinansKalemleri(tenantId, {
    tur: body.tur,
    aktif: 'all',
    includeSistem: false
  })
}

async function assertTenantKalem(tenantId: string, id: string): Promise<TenantFinansKalemi> {
  const row = await prisma.tenantFinansKalemi.findFirst({ where: { id, tenantId } })
  if (!row) {
    throw new AppError(404, 'Kalem bulunamadı.', 'NOT_FOUND')
  }
  return row
}

/**
 * Manuel hareket oluştururken aktif, kullanıcı yönetimli kalemi doğrular.
 * Snapshot adı için `ad` döner.
 */
export async function resolveAktifManuelKalem(
  tenantId: string,
  tur: FinansKalemTuru,
  kalemId: string
): Promise<TenantFinansKalemi> {
  const row = await prisma.tenantFinansKalemi.findFirst({
    where: { id: kalemId, tenantId, tur }
  })
  if (!row) {
    throw new AppError(400, 'Geçersiz kalem seçimi.', 'FINANS_KALEM_INVALID')
  }
  if (row.sistemMi) {
    throw new AppError(400, 'Sistem kalemi manuel girişte kullanılamaz.', 'FINANS_KALEM_SISTEM')
  }
  if (!row.aktif) {
    throw new AppError(
      400,
      'Bu kalem artık aktif değil, başka bir kalem seçin.',
      'FINANS_KALEM_INACTIVE'
    )
  }
  return row
}

export function assertOzelAdForKalem(
  tur: FinansKalemTuru,
  kalemAd: string,
  ozelAd: string | null | undefined
): string | null {
  const needsOzel =
    tur === FinansKalemTuru.GELIR ? isDigerGelirKalemAd(kalemAd) : isDigerGiderKalemAd(kalemAd)
  const oz = ozelAd?.trim() ?? ''
  if (needsOzel) {
    if (oz.length < 2) {
      throw new AppError(
        400,
        tur === FinansKalemTuru.GELIR
          ? 'Diğer gelir için özel kategori adı zorunludur.'
          : 'Diğer gider/masraf için özel ad zorunludur.',
        'VALIDATION'
      )
    }
    return oz
  }
  if (oz.length > 0) {
    throw new AppError(400, 'Özel ad yalnızca «Diğer» kalemleri için kullanılır.', 'VALIDATION')
  }
  return null
}

export { normalizeFinansKalemAd, isDigerGelirKalemAd, isDigerGiderKalemAd }
