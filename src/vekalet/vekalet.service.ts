import type { Prisma, UserRole, VekaletTaksitOdemeDurumu } from '@prisma/client'
import { Prisma as PrismaNamespace } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import type {
  CreateVekaletTaksitiBody,
  MarkTaksitPaidBody,
  MarkTaksitSmmBody,
  UpdateVekaletTaksitiBody,
  UpsertVekaletUcretiBody
} from './vekalet.schemas.js'

function decimalStr(d: Prisma.Decimal): string {
  return d.toFixed(2)
}

export function serializeVekaletUcreti(v: {
  id: string
  tenantId: string
  dosyaId: string
  muvekkilId: string
  toplamTutar: Prisma.Decimal
  aciklama: string | null
  createdById: string
  updatedById: string | null
  createdAt: Date
  updatedAt: Date
}): Record<string, unknown> {
  return {
    id: v.id,
    tenantId: v.tenantId,
    dosyaId: v.dosyaId,
    muvekkilId: v.muvekkilId,
    toplamTutar: decimalStr(v.toplamTutar),
    aciklama: v.aciklama,
    createdById: v.createdById,
    updatedById: v.updatedById,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString()
  }
}

export function serializeVekaletTaksiti(t: {
  id: string
  tenantId: string
  dosyaId: string
  muvekkilId: string
  vekaletUcretiId: string
  taksitNo: number
  vadeTarihi: Date
  tutar: Prisma.Decimal
  odemeDurumu: VekaletTaksitOdemeDurumu
  odemeTarihi: Date | null
  aciklama: string | null
  makbuzNo: string | null
  smmKesildiMi: boolean
  smmKesimTarihi: Date | null
  smmNo: string | null
  smmAciklama: string | null
  createdById: string
  updatedById: string | null
  createdAt: Date
  updatedAt: Date
}): Record<string, unknown> {
  return {
    id: t.id,
    tenantId: t.tenantId,
    dosyaId: t.dosyaId,
    muvekkilId: t.muvekkilId,
    vekaletUcretiId: t.vekaletUcretiId,
    taksitNo: t.taksitNo,
    vadeTarihi: t.vadeTarihi.toISOString(),
    tutar: decimalStr(t.tutar),
    odemeDurumu: t.odemeDurumu,
    odemeTarihi: t.odemeTarihi?.toISOString() ?? null,
    aciklama: t.aciklama,
    makbuzNo: t.makbuzNo,
    smmKesildiMi: t.smmKesildiMi,
    smmKesimTarihi: t.smmKesimTarihi?.toISOString() ?? null,
    smmNo: t.smmNo,
    smmAciklama: t.smmAciklama,
    createdById: t.createdById,
    updatedById: t.updatedById,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString()
  }
}

function computeOzet(
  anlasilan: Prisma.Decimal,
  taksitler: { tutar: Prisma.Decimal; odemeDurumu: VekaletTaksitOdemeDurumu; smmKesildiMi: boolean }[]
): {
  anlasilan: string
  odenenToplam: string
  kalanVekalet: string
  odenmemisTaksitSayisi: number
  smmBekleyenSayisi: number
} {
  let odenen = 0
  let odenmemis = 0
  let smmBekleyen = 0
  for (const t of taksitler) {
    if (t.odemeDurumu === 'ODENDI') {
      odenen += Number(t.tutar)
      if (!t.smmKesildiMi) smmBekleyen += 1
    } else if (t.odemeDurumu === 'ODENMEDI') {
      odenmemis += 1
    }
  }
  const a = Number(anlasilan)
  const kalan = Math.max(0, a - odenen)
  const f = (n: number) => n.toFixed(2)
  return {
    anlasilan: f(a),
    odenenToplam: f(odenen),
    kalanVekalet: f(kalan),
    odenmemisTaksitSayisi: odenmemis,
    smmBekleyenSayisi: smmBekleyen
  }
}

async function assertDosyaForVekalet(
  tenantId: string,
  dosyaId: string
): Promise<{ id: string; muvekkilId: string } | null> {
  return prisma.dosya.findFirst({
    where: { id: dosyaId, tenantId, aktifMi: true },
    select: { id: true, muvekkilId: true }
  })
}

async function nextMakbuzNo(tx: Prisma.TransactionClient, tenantId: string, tarihRef: Date): Promise<string> {
  const year = tarihRef.getFullYear()
  const prefix = `VEK-${year}-`
  const last = await tx.vekaletTaksiti.findFirst({
    where: { tenantId, makbuzNo: { startsWith: prefix } },
    orderBy: { makbuzNo: 'desc' },
    select: { makbuzNo: true }
  })
  let n = 1
  if (last?.makbuzNo) {
    const parts = last.makbuzNo.split('-')
    const num = parseInt(parts[2] ?? '0', 10)
    if (!Number.isNaN(num)) n = num + 1
  }
  return `${prefix}${String(n).padStart(6, '0')}`
}

export async function listSmmBekleyenForDosya(
  tenantId: string,
  dosyaId: string
): Promise<Record<string, unknown>[] | null> {
  const dosya = await assertDosyaForVekalet(tenantId, dosyaId)
  if (!dosya) return null

  const rows = await prisma.vekaletTaksiti.findMany({
    where: {
      tenantId,
      dosyaId,
      odemeDurumu: 'ODENDI',
      smmKesildiMi: false
    },
    orderBy: [{ odemeTarihi: 'desc' }, { taksitNo: 'asc' }]
  })
  return rows.map(serializeVekaletTaksiti)
}

export async function getDosyaVekaletPackage(tenantId: string, dosyaId: string): Promise<{
  vekaletUcreti: Record<string, unknown> | null
  taksitler: Record<string, unknown>[]
  ozet: ReturnType<typeof computeOzet>
  smmBekleyen: Record<string, unknown>[]
} | null> {
  const dosya = await assertDosyaForVekalet(tenantId, dosyaId)
  if (!dosya) return null

  const smmBekleyenRows = await listSmmBekleyenForDosya(tenantId, dosyaId)
  if (smmBekleyenRows === null) return null

  const vekalet = await prisma.vekaletUcreti.findUnique({
    where: { dosyaId },
    include: {
      taksitler: { orderBy: [{ taksitNo: 'asc' }, { vadeTarihi: 'asc' }] }
    }
  })

  if (!vekalet) {
    const zero = new PrismaNamespace.Decimal(0)
    return {
      vekaletUcreti: null,
      taksitler: [],
      ozet: computeOzet(zero, []),
      smmBekleyen: smmBekleyenRows
    }
  }

  const ozet = computeOzet(vekalet.toplamTutar, vekalet.taksitler)
  return {
    vekaletUcreti: serializeVekaletUcreti(vekalet),
    taksitler: vekalet.taksitler.map(serializeVekaletTaksiti),
    ozet,
    smmBekleyen: smmBekleyenRows
  }
}

export async function upsertVekaletUcreti(
  tenantId: string,
  userId: string,
  dosyaId: string,
  body: UpsertVekaletUcretiBody,
  req: Request
): Promise<Record<string, unknown>> {
  const dosya = await assertDosyaForVekalet(tenantId, dosyaId)
  if (!dosya) {
    throw new AppError(404, 'Dosya bulunamadı.', 'NOT_FOUND')
  }

  const meta = getRequestMeta(req)
  const tutar = new PrismaNamespace.Decimal(body.toplamTutar)

  const existing = await prisma.vekaletUcreti.findUnique({ where: { dosyaId } })
  if (existing) {
    const updated = await prisma.vekaletUcreti.update({
      where: { id: existing.id },
      data: {
        toplamTutar: tutar,
        aciklama: body.aciklama?.trim() || null,
        updatedById: userId
      }
    })
    await writeAuditLog({
      tenantId,
      userId,
      action: 'VEKALET_UCRETI_UPSERTED',
      entityType: 'VekaletUcreti',
      entityId: updated.id,
      oldValue: serializeVekaletUcreti(existing),
      newValue: serializeVekaletUcreti(updated),
      meta: { dosyaId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    return serializeVekaletUcreti(updated)
  }

  const created = await prisma.vekaletUcreti.create({
    data: {
      tenantId,
      dosyaId,
      muvekkilId: dosya.muvekkilId,
      toplamTutar: tutar,
      aciklama: body.aciklama?.trim() || null,
      createdById: userId
    }
  })
  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_UCRETI_UPSERTED',
    entityType: 'VekaletUcreti',
    entityId: created.id,
    newValue: serializeVekaletUcreti(created),
    meta: { dosyaId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
  return serializeVekaletUcreti(created)
}

export async function createVekaletTaksiti(
  tenantId: string,
  userId: string,
  dosyaId: string,
  body: CreateVekaletTaksitiBody,
  req: Request
): Promise<Record<string, unknown>> {
  const dosya = await assertDosyaForVekalet(tenantId, dosyaId)
  if (!dosya) {
    throw new AppError(404, 'Dosya bulunamadı.', 'NOT_FOUND')
  }
  const vekalet = await prisma.vekaletUcreti.findUnique({ where: { dosyaId } })
  if (!vekalet) {
    throw new AppError(400, 'Önce vekalet ücreti tanımlanmalıdır.', 'VEKALET_REQUIRED')
  }

  const meta = getRequestMeta(req)
  const tutar = new PrismaNamespace.Decimal(body.tutar)

  try {
    const row = await prisma.vekaletTaksiti.create({
      data: {
        tenantId,
        dosyaId,
        muvekkilId: dosya.muvekkilId,
        vekaletUcretiId: vekalet.id,
        taksitNo: body.taksitNo,
        vadeTarihi: body.vadeTarihi,
        tutar,
        aciklama: body.aciklama?.trim() || null,
        createdById: userId
      }
    })
    await writeAuditLog({
      tenantId,
      userId,
      action: 'VEKALET_TAKSIT_CREATED',
      entityType: 'VekaletTaksiti',
      entityId: row.id,
      newValue: serializeVekaletTaksiti(row),
      meta: { dosyaId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    return serializeVekaletTaksiti(row)
  } catch (e) {
    if (e instanceof PrismaNamespace.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError(409, 'Bu taksit numarası zaten kullanılıyor.', 'CONFLICT')
    }
    throw e
  }
}

async function getTaksitForTenant(tenantId: string, taksitId: string) {
  return prisma.vekaletTaksiti.findFirst({
    where: { id: taksitId, tenantId }
  })
}

function isYonetici(role: UserRole): boolean {
  return role === 'BURO_SAHIBI' || role === 'AVUKAT_YONETICI'
}

export async function updateVekaletTaksiti(
  tenantId: string,
  userId: string,
  role: UserRole,
  taksitId: string,
  body: UpdateVekaletTaksitiBody,
  req: Request
): Promise<Record<string, unknown>> {
  const existing = await getTaksitForTenant(tenantId, taksitId)
  if (!existing) {
    throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')
  }

  const meta = getRequestMeta(req)
  const nextOdeme = body.odemeDurumu ?? existing.odemeDurumu
  const wasPaid = existing.odemeDurumu === 'ODENDI'

  if (wasPaid && nextOdeme === 'ODENMEDI' && !isYonetici(role)) {
    throw new AppError(403, 'Ödenmiş taksidi geri almak için yetkiniz yok.', 'FORBIDDEN')
  }

  let odemeTarihi = existing.odemeTarihi
  let makbuzNo = existing.makbuzNo
  let smmKesildiMi = existing.smmKesildiMi
  let smmKesimTarihi = existing.smmKesimTarihi
  let smmNo = existing.smmNo
  let smmAciklama = existing.smmAciklama

  if (existing.odemeDurumu !== 'ODENDI' && nextOdeme === 'ODENDI') {
    odemeTarihi = body.odemeTarihi ?? new Date()
    smmKesildiMi = false
    smmKesimTarihi = null
    smmNo = null
    smmAciklama = null
  }

  if (wasPaid && nextOdeme === 'ODENMEDI') {
    odemeTarihi = null
    makbuzNo = null
    smmKesildiMi = false
    smmKesimTarihi = null
    smmNo = null
    smmAciklama = null
  }

  if (body.odemeTarihi !== undefined) {
    odemeTarihi = body.odemeTarihi
  }

  const updated = await prisma.$transaction(async (tx) => {
    let mb = makbuzNo
    if (nextOdeme === 'ODENDI' && !mb) {
      mb = await nextMakbuzNo(tx, tenantId, odemeTarihi ?? new Date())
    }
    return tx.vekaletTaksiti.update({
      where: { id: existing.id },
      data: {
        taksitNo: body.taksitNo ?? undefined,
        vadeTarihi: body.vadeTarihi ?? undefined,
        tutar: body.tutar != null ? new PrismaNamespace.Decimal(body.tutar) : undefined,
        odemeDurumu: body.odemeDurumu ?? undefined,
        odemeTarihi,
        aciklama: body.aciklama !== undefined ? body.aciklama?.trim() || null : undefined,
        makbuzNo: mb,
        smmKesildiMi,
        smmKesimTarihi,
        smmNo,
        smmAciklama,
        updatedById: userId
      }
    })
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_TAKSIT_UPDATED',
    entityType: 'VekaletTaksiti',
    entityId: updated.id,
    oldValue: serializeVekaletTaksiti(existing),
    newValue: serializeVekaletTaksiti(updated),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeVekaletTaksiti(updated)
}

export async function markVekaletTaksitPaid(
  tenantId: string,
  userId: string,
  taksitId: string,
  body: MarkTaksitPaidBody,
  req: Request
): Promise<Record<string, unknown>> {
  const existing = await getTaksitForTenant(tenantId, taksitId)
  if (!existing) {
    throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')
  }
  if (existing.odemeDurumu === 'IPTAL') {
    throw new AppError(400, 'İptal edilmiş taksit ödenemez.', 'INVALID_STATE')
  }
  if (existing.odemeDurumu === 'ODENDI') {
    throw new AppError(400, 'Taksit zaten ödenmiş.', 'ALREADY_PAID')
  }

  const meta = getRequestMeta(req)
  const odemeTarihi = body.odemeTarihi ?? new Date()

  const updated = await prisma.$transaction(async (tx) => {
    const makbuzNo = existing.makbuzNo ?? (await nextMakbuzNo(tx, tenantId, odemeTarihi))
    return tx.vekaletTaksiti.update({
      where: { id: existing.id },
      data: {
        odemeDurumu: 'ODENDI',
        odemeTarihi,
        aciklama: body.aciklama !== undefined ? body.aciklama?.trim() || null : existing.aciklama,
        makbuzNo,
        smmKesildiMi: false,
        smmKesimTarihi: null,
        smmNo: null,
        smmAciklama: null,
        updatedById: userId
      }
    })
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_TAKSIT_PAID',
    entityType: 'VekaletTaksiti',
    entityId: updated.id,
    oldValue: serializeVekaletTaksiti(existing),
    newValue: serializeVekaletTaksiti(updated),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeVekaletTaksiti(updated)
}

export async function markVekaletTaksitSmm(
  tenantId: string,
  userId: string,
  taksitId: string,
  body: MarkTaksitSmmBody,
  req: Request
): Promise<Record<string, unknown>> {
  const existing = await getTaksitForTenant(tenantId, taksitId)
  if (!existing) {
    throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')
  }
  if (existing.odemeDurumu !== 'ODENDI') {
    throw new AppError(400, 'SMM yalnızca ödenmiş taksitler için işaretlenebilir.', 'INVALID_STATE')
  }

  const meta = getRequestMeta(req)
  const updated = await prisma.vekaletTaksiti.update({
    where: { id: existing.id },
    data: {
      smmKesildiMi: true,
      smmNo: body.smmNo.trim(),
      smmKesimTarihi: body.smmKesimTarihi,
      smmAciklama: body.smmAciklama?.trim() || null,
      updatedById: userId
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_TAKSIT_SMM_MARKED',
    entityType: 'VekaletTaksiti',
    entityId: updated.id,
    oldValue: serializeVekaletTaksiti(existing),
    newValue: serializeVekaletTaksiti(updated),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeVekaletTaksiti(updated)
}

export async function cancelVekaletTaksiti(
  tenantId: string,
  userId: string,
  role: UserRole,
  taksitId: string,
  req: Request
): Promise<Record<string, unknown>> {
  if (!isYonetici(role)) {
    throw new AppError(403, 'Taksit iptali için yetkiniz yok.', 'FORBIDDEN')
  }

  const existing = await getTaksitForTenant(tenantId, taksitId)
  if (!existing) {
    throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')
  }
  if (existing.odemeDurumu === 'IPTAL') {
    throw new AppError(400, 'Taksit zaten iptal.', 'INVALID_STATE')
  }

  const meta = getRequestMeta(req)
  const updated = await prisma.vekaletTaksiti.update({
    where: { id: existing.id },
    data: {
      odemeDurumu: 'IPTAL',
      updatedById: userId
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_TAKSIT_CANCELLED',
    entityType: 'VekaletTaksiti',
    entityId: updated.id,
    oldValue: serializeVekaletTaksiti(existing),
    newValue: serializeVekaletTaksiti(updated),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeVekaletTaksiti(updated)
}
