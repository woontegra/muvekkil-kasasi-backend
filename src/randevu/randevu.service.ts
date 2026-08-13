import type { Dosya, Muvekkil, Prisma, Randevu, User } from '@prisma/client'
import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { getMuvekkilById } from '../muvekkil/muvekkil.service.js'
import type { CreateRandevuBody, ListRandevuQuery, UpdateRandevuBody } from './randevu.schemas.js'
import { replanRandevuJobs, cancelPendingRandevuJobs } from './randevuBildirim.planner.js'
import { setRandevuHatirlatmaPlan } from '../tahsilatBildirim/bildirimPlan.service.js'
import type { BildirimPlanModu } from '@prisma/client'

type RandevuWithRelations = Randevu & {
  muvekkil: Pick<Muvekkil, 'id' | 'gorunenAd'> | null
  dosya: Pick<Dosya, 'id' | 'konuBasligi' | 'muvekkilId'> | null
  sorumluUser: Pick<User, 'id' | 'adSoyad'> | null
  olusturanUser: Pick<User, 'id' | 'adSoyad'>
}

const randevuInclude = {
  muvekkil: { select: { id: true, gorunenAd: true } },
  dosya: { select: { id: true, konuBasligi: true, muvekkilId: true } },
  sorumluUser: { select: { id: true, adSoyad: true } },
  olusturanUser: { select: { id: true, adSoyad: true } }
} satisfies Prisma.RandevuInclude

export function serializeRandevu(
  r: RandevuWithRelations,
  extra?: { hatirlatmaOzet?: string }
): Record<string, unknown> {
  return {
    id: r.id,
    tenantId: r.tenantId,
    muvekkilId: r.muvekkilId,
    dosyaId: r.dosyaId,
    olusturanUserId: r.olusturanUserId,
    sorumluUserId: r.sorumluUserId,
    baslik: r.baslik,
    baslangicAt: r.baslangicAt.toISOString(),
    bitisAt: r.bitisAt.toISOString(),
    konum: r.konum,
    aciklama: r.aciklama,
    aktifMi: r.aktifMi,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    muvekkilAd: r.muvekkil?.gorunenAd ?? null,
    dosyaBaslik: r.dosya?.konuBasligi ?? null,
    sorumluAdSoyad: r.sorumluUser?.adSoyad ?? null,
    olusturanAdSoyad: r.olusturanUser.adSoyad,
    hatirlatmaOzet: extra?.hatirlatmaOzet ?? null
  }
}

async function assertUserInTenant(tenantId: string, userId: string): Promise<void> {
  const u = await prisma.user.findFirst({
    where: { id: userId, tenantId, aktifMi: true },
    select: { id: true }
  })
  if (!u) {
    throw new AppError(400, 'Sorumlu kullanıcı bu büroda bulunamadı.', 'INVALID_SORUMLU')
  }
}

async function assertDosyaForRandevu(
  tenantId: string,
  dosyaId: string,
  muvekkilId: string | null
): Promise<Dosya> {
  const dosya = await prisma.dosya.findFirst({
    where: { id: dosyaId, tenantId, aktifMi: true }
  })
  if (!dosya) {
    throw new AppError(400, 'Dosya bulunamadı veya bu büroya ait değil.', 'INVALID_DOSYA')
  }
  if (muvekkilId && dosya.muvekkilId !== muvekkilId) {
    throw new AppError(400, 'Seçilen dosya bu müvekkile ait değil.', 'DOSYA_MUVEKKIL_MISMATCH')
  }
  return dosya
}

async function validateRelations(
  tenantId: string,
  body: { muvekkilId: string | null; dosyaId: string | null; sorumluUserId: string | null }
): Promise<{ muvekkilId: string | null; dosyaId: string | null }> {
  let muvekkilId = body.muvekkilId
  let dosyaId = body.dosyaId

  if (muvekkilId) {
    const mu = await getMuvekkilById(tenantId, muvekkilId)
    if (!mu) {
      throw new AppError(400, 'Müvekkil bulunamadı veya bu büroya ait değil.', 'INVALID_MUVEKKIL')
    }
  }

  if (dosyaId) {
    const dosya = await assertDosyaForRandevu(tenantId, dosyaId, muvekkilId)
    if (!muvekkilId) {
      muvekkilId = dosya.muvekkilId
    }
  }

  if (body.sorumluUserId) {
    await assertUserInTenant(tenantId, body.sorumluUserId)
  }

  return { muvekkilId, dosyaId }
}

export async function listRandevular(
  tenantId: string,
  query: ListRandevuQuery
): Promise<RandevuWithRelations[]> {
  const start = new Date(query.baslangic)
  const end = new Date(query.bitis)
  if (end <= start) {
    throw new AppError(400, 'Bitiş tarihi başlangıçtan sonra olmalıdır.', 'INVALID_RANGE')
  }

  const where: Prisma.RandevuWhereInput = {
    tenantId,
    aktifMi: true,
    baslangicAt: { lt: end },
    bitisAt: { gt: start },
    ...(query.muvekkilId ? { muvekkilId: query.muvekkilId } : {}),
    ...(query.sorumluUserId ? { sorumluUserId: query.sorumluUserId } : {})
  }

  const items = await prisma.randevu.findMany({
    where,
    include: randevuInclude,
    orderBy: [{ baslangicAt: 'asc' }, { baslik: 'asc' }]
  })

  const { getRandevuHatirlatmaPlan } = await import('../tahsilatBildirim/bildirimPlan.service.js')
  const ozetMap = new Map<string, string>()
  await Promise.all(
    items.map(async (r) => {
      try {
        const p = await getRandevuHatirlatmaPlan(tenantId, r.id)
        ozetMap.set(r.id, p.ozet)
      } catch {
        ozetMap.set(r.id, 'Büro ayarı')
      }
    })
  )

  return items.map((r) => Object.assign(r, { _hatirlatmaOzet: ozetMap.get(r.id) }))
}

export async function getRandevuById(tenantId: string, id: string): Promise<RandevuWithRelations | null> {
  return prisma.randevu.findFirst({
    where: { id, tenantId, aktifMi: true },
    include: randevuInclude
  })
}

export async function createRandevu(
  tenantId: string,
  userId: string,
  body: CreateRandevuBody,
  _req?: Request
): Promise<RandevuWithRelations> {
  const { muvekkilId, dosyaId } = await validateRelations(tenantId, body)

  const created = await prisma.randevu.create({
    data: {
      tenantId,
      olusturanUserId: userId,
      sorumluUserId: body.sorumluUserId,
      muvekkilId,
      dosyaId,
      baslik: body.baslik.trim(),
      baslangicAt: new Date(body.baslangicAt),
      bitisAt: new Date(body.bitisAt),
      konum: body.konum,
      aciklama: body.aciklama,
      aktifMi: true
    },
    include: randevuInclude
  })

  if (body.hatirlatmaPlan) {
    await applyRandevuHatirlatmaPlan(tenantId, userId, created.id, {
      mode: body.hatirlatmaPlan.mode as BildirimPlanModu,
      kurallar: body.hatirlatmaPlan.kurallar
    }, _req)
  } else {
    await replanRandevuJobs(tenantId, created.id)
  }

  return created
}

export async function updateRandevu(
  tenantId: string,
  userId: string,
  id: string,
  body: UpdateRandevuBody,
  _req?: Request
): Promise<RandevuWithRelations> {
  const existing = await getRandevuById(tenantId, id)
  if (!existing) {
    throw new AppError(404, 'Randevu bulunamadı.', 'NOT_FOUND')
  }

  const { muvekkilId, dosyaId } = await validateRelations(tenantId, body)

  const updated = await prisma.randevu.update({
    where: { id },
    data: {
      sorumluUserId: body.sorumluUserId,
      muvekkilId,
      dosyaId,
      baslik: body.baslik.trim(),
      baslangicAt: new Date(body.baslangicAt),
      bitisAt: new Date(body.bitisAt),
      konum: body.konum,
      aciklama: body.aciklama
    },
    include: randevuInclude
  })

  if (body.hatirlatmaPlan) {
    await applyRandevuHatirlatmaPlan(tenantId, userId, id, {
      mode: body.hatirlatmaPlan.mode as BildirimPlanModu,
      kurallar: body.hatirlatmaPlan.kurallar
    }, _req)
  } else {
    await replanRandevuJobs(tenantId, id)
  }

  return updated
}

export async function deactivateRandevu(tenantId: string, id: string, _req?: Request): Promise<void> {
  const existing = await getRandevuById(tenantId, id)
  if (!existing) {
    throw new AppError(404, 'Randevu bulunamadı.', 'NOT_FOUND')
  }

  await prisma.randevu.update({
    where: { id },
    data: { aktifMi: false }
  })
  await cancelPendingRandevuJobs(tenantId, id, 'Randevu iptal edildi')
}

async function applyRandevuHatirlatmaPlan(
  tenantId: string,
  userId: string,
  randevuId: string,
  plan: {
    mode: BildirimPlanModu
    kurallar?: Array<{
      ruleKey: string
      aktifMi: boolean
      offsetDk: number
      metaSablonId?: string | null
    }>
  },
  req?: Request
): Promise<void> {
  if (!req) {
    await replanRandevuJobs(tenantId, randevuId)
    return
  }
  await setRandevuHatirlatmaPlan({
    tenantId,
    userId,
    randevuId,
    mode: plan.mode,
    kurallar: plan.kurallar?.map((k) => ({
      ruleKey: k.ruleKey,
      aktifMi: k.aktifMi,
      offsetDk: k.offsetDk,
      metaSablonId: k.metaSablonId ?? null
    })),
    req
  })
}
