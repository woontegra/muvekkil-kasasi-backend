import type { Prisma, UserRole, VekaletTaksitOdemeDurumu, VekaletTaksiti } from '@prisma/client'
import { Prisma as PrismaNamespace } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import type {
  CreateVekaletTaksitiBody,
  CreateVekaletTaksitPlaniBody,
  CreateTekVekaletTaksitiBody,
  MarkTaksitPaidBody,
  MarkTaksitSmmBody,
  UpdateVekaletTaksitiBody,
  UpsertVekaletUcretiBody
} from './vekalet.schemas.js'

export type TaksitComputedDurum = 'ODENMEDI' | 'KISMI_ODENDI' | 'ODENDI' | 'GECIKTI'
export type TaksitSmmDurum = 'YOK' | 'BEKLIYOR' | 'KESILDI'

type OdemeRow = { id: string; tutar: Prisma.Decimal; odemeTarihi: Date; makbuzNo: string; smmKesildiMi: boolean }

function sumOdemeTutar(odemeler: { tutar: Prisma.Decimal }[]): number {
  return odemeler.reduce((s, o) => s + Number(o.tutar), 0)
}

export function computeTaksitDurum(
  taksit: Pick<VekaletTaksiti, 'tutar' | 'vadeTarihi' | 'odemeDurumu'>,
  odemeler: { tutar: Prisma.Decimal }[]
): TaksitComputedDurum {
  if (taksit.odemeDurumu === 'IPTAL') return 'ODENMEDI'
  const taksitTutari = Number(taksit.tutar)
  const odenen = sumOdemeTutar(odemeler)
  const kalan = Math.max(0, taksitTutari - odenen)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const gecikti = taksit.vadeTarihi < startOfToday && kalan > 0.0001
  if (gecikti) return 'GECIKTI'
  if (odenen <= 0) return 'ODENMEDI'
  if (odenen + 0.0001 < taksitTutari) return 'KISMI_ODENDI'
  return 'ODENDI'
}

export function computeTaksitSmmDurum(odemeler: { smmKesildiMi: boolean; tutar: Prisma.Decimal }[]): TaksitSmmDurum {
  if (odemeler.length === 0) return 'YOK'
  const hasPayment = odemeler.some((o) => Number(o.tutar) > 0)
  if (!hasPayment) return 'YOK'
  if (odemeler.some((o) => !o.smmKesildiMi)) return 'BEKLIYOR'
  return 'KESILDI'
}

export function serializeVekaletTaksitiWithOzet(
  t: VekaletTaksiti,
  odemeler: OdemeRow[]
): Record<string, unknown> {
  const base = serializeVekaletTaksiti(t)
  const taksitTutari = Number(t.tutar)
  const odenenToplam = sumOdemeTutar(odemeler)
  const kalanTutar = Math.max(0, taksitTutari - odenenToplam)
  const durum = computeTaksitDurum(t, odemeler)
  const son = odemeler.length > 0 ? odemeler[odemeler.length - 1] : null
  const smmDurumu = computeTaksitSmmDurum(odemeler)
  let smmBekleyenOdemeId: string | null = null
  for (let i = odemeler.length - 1; i >= 0; i--) {
    if (!odemeler[i].smmKesildiMi) {
      smmBekleyenOdemeId = odemeler[i].id
      break
    }
  }
  return {
    ...base,
    taksitTutari: decimalStr(t.tutar),
    odenenToplam: odenenToplam.toFixed(2),
    kalanTutar: kalanTutar.toFixed(2),
    durum,
    sonOdemeTarihi: son?.odemeTarihi.toISOString() ?? null,
    sonMakbuzNo: son?.makbuzNo ?? null,
    smmDurumu,
    smmBekleyenOdemeId
  }
}

async function loadTaksitOdemeler(taksitId: string): Promise<OdemeRow[]> {
  return prisma.vekaletTaksitOdeme.findMany({
    where: { taksitId },
    orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }]
  })
}

export async function serializeTaksitApiResponse(t: VekaletTaksiti): Promise<Record<string, unknown>> {
  const odemeler = await loadTaksitOdemeler(t.id)
  return serializeVekaletTaksitiWithOzet(t, odemeler)
}

export async function syncTaksitOdemeDurumu(
  tx: Prisma.TransactionClient,
  taksitId: string,
  userId: string
): Promise<VekaletTaksiti> {
  const taksit = await tx.vekaletTaksiti.findUniqueOrThrow({
    where: { id: taksitId },
    include: { odemeler: { orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }] } }
  })
  if (taksit.odemeDurumu === 'IPTAL') return taksit

  const odenen = sumOdemeTutar(taksit.odemeler)
  const taksitTutari = Number(taksit.tutar)
  let odemeDurumu: VekaletTaksitOdemeDurumu = 'ODENMEDI'
  if (odenen <= 0) odemeDurumu = 'ODENMEDI'
  else if (odenen + 0.0001 < taksitTutari) odemeDurumu = 'KISMI_ODENDI'
  else odemeDurumu = 'ODENDI'

  const son = taksit.odemeler[taksit.odemeler.length - 1]
  const allSmm = taksit.odemeler.length > 0 && taksit.odemeler.every((o) => o.smmKesildiMi)

  return tx.vekaletTaksiti.update({
    where: { id: taksitId },
    data: {
      odemeDurumu,
      odemeTarihi: son?.odemeTarihi ?? null,
      makbuzNo: son?.makbuzNo ?? null,
      smmKesildiMi: taksit.odemeler.length > 0 ? allSmm : false,
      smmKesimTarihi: allSmm ? (taksit.smmKesimTarihi ?? new Date()) : null,
      updatedById: userId
    }
  })
}

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

function sumTaksitTutarlari(
  taksitler: { tutar: Prisma.Decimal; odemeDurumu: VekaletTaksitOdemeDurumu }[]
): number {
  return taksitler
    .filter((t) => t.odemeDurumu !== 'IPTAL')
    .reduce((s, t) => s + Number(t.tutar), 0)
}

export function kalanTaksitlendirmeTutari(
  anlasilan: Prisma.Decimal,
  taksitler: { tutar: Prisma.Decimal; odemeDurumu: VekaletTaksitOdemeDurumu }[]
): number {
  return Math.max(0, Number(anlasilan) - sumTaksitTutarlari(taksitler))
}

function kalanVekaletTutari(
  anlasilan: Prisma.Decimal,
  taksitler: {
    odemeDurumu: VekaletTaksitOdemeDurumu
    odemeler: { tutar: Prisma.Decimal }[]
  }[]
): number {
  let odenen = 0
  for (const t of taksitler) {
    if (t.odemeDurumu === 'IPTAL') continue
    odenen += sumOdemeTutar(t.odemeler)
  }
  return Math.max(0, Number(anlasilan) - odenen)
}

function hasAcikVekaletTaksiti(
  taksitler: { odemeDurumu: VekaletTaksitOdemeDurumu }[]
): boolean {
  return taksitler.some(
    (t) => t.odemeDurumu === 'ODENMEDI' || t.odemeDurumu === 'KISMI_ODENDI'
  )
}

function vadeEkleAy(base: Date, ayOffset: number): Date {
  const d = new Date(base)
  d.setMonth(d.getMonth() + ayOffset)
  return d
}

function hesaplaSabitTaksitPlani(taksitTutari: number, adet: number): number[] | null {
  if (!Number.isFinite(taksitTutari) || taksitTutari <= 0) return null
  if (!Number.isFinite(adet) || adet < 1 || adet > 120) return null
  const tutar = Math.round(taksitTutari * 100) / 100
  return Array.from({ length: adet }, () => tutar)
}

async function nextTaksitNo(tx: Prisma.TransactionClient, vekaletUcretiId: string): Promise<number> {
  const max = await tx.vekaletTaksiti.aggregate({
    where: { vekaletUcretiId },
    _max: { taksitNo: true }
  })
  return (max._max.taksitNo ?? 0) + 1
}

function computeOzet(
  anlasilan: Prisma.Decimal,
  taksitler: {
    tutar: Prisma.Decimal
    odemeDurumu: VekaletTaksitOdemeDurumu
    odemeler: { tutar: Prisma.Decimal; smmKesildiMi: boolean }[]
  }[]
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
    if (t.odemeDurumu === 'IPTAL') continue
    const tOdenen = sumOdemeTutar(t.odemeler)
    odenen += tOdenen
    if (t.odemeDurumu === 'ODENMEDI' || t.odemeDurumu === 'KISMI_ODENDI') {
      odenmemis += 1
    }
    smmBekleyen += t.odemeler.filter((o) => !o.smmKesildiMi).length
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

  const rows = await prisma.vekaletTaksitOdeme.findMany({
    where: {
      tenantId,
      dosyaId,
      smmKesildiMi: false
    },
    orderBy: [{ odemeTarihi: 'desc' }, { createdAt: 'desc' }]
  })
  return rows.map((o) => ({
    id: o.id,
    odemeId: o.id,
    taksitId: o.taksitId,
    odemeTarihi: o.odemeTarihi.toISOString(),
    tutar: decimalStr(o.tutar),
    makbuzNo: o.makbuzNo,
    smmKesildiMi: o.smmKesildiMi
  }))
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
      taksitler: {
        orderBy: [{ taksitNo: 'asc' }, { vadeTarihi: 'asc' }],
        include: {
          odemeler: { orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }] }
        }
      }
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
    taksitler: vekalet.taksitler.map((t) => serializeVekaletTaksitiWithOzet(t, t.odemeler)),
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
    return serializeVekaletTaksitiWithOzet(row, [])
  } catch (e) {
    if (e instanceof PrismaNamespace.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError(409, 'Bu taksit numarası zaten kullanılıyor.', 'CONFLICT')
    }
    throw e
  }
}

export async function createTekVekaletTaksiti(
  tenantId: string,
  userId: string,
  dosyaId: string,
  body: CreateTekVekaletTaksitiBody,
  req: Request
): Promise<Record<string, unknown>> {
  const dosya = await assertDosyaForVekalet(tenantId, dosyaId)
  if (!dosya) {
    throw new AppError(404, 'Dosya bulunamadı.', 'NOT_FOUND')
  }
  const vekalet = await prisma.vekaletUcreti.findUnique({
    where: { dosyaId },
    include: {
      taksitler: {
        where: { odemeDurumu: { not: 'IPTAL' } },
        include: { odemeler: true }
      }
    }
  })
  if (!vekalet) {
    throw new AppError(400, 'Önce vekalet ücreti tanımlanmalıdır.', 'VEKALET_REQUIRED')
  }

  const kalanPlan = kalanTaksitlendirmeTutari(vekalet.toplamTutar, vekalet.taksitler)
  if (kalanPlan <= 0.0001) {
    throw new AppError(400, 'Taksitlendirilebilir kalan tutar yok.', 'NO_REMAINING')
  }

  const kalanVekalet = kalanVekaletTutari(vekalet.toplamTutar, vekalet.taksitler)
  if (kalanVekalet <= 0.0001) {
    throw new AppError(400, 'Kalan vekalet tutarı yok.', 'NO_REMAINING_VEKALET')
  }

  if (hasAcikVekaletTaksiti(vekalet.taksitler)) {
    throw new AppError(
      409,
      'Açık taksitler var. Tek taksit oluşturmak için önce mevcut açık taksitleri silin veya düzenleyin.',
      'OPEN_TAKSIT_CONFLICT'
    )
  }

  const maxTutar = Math.min(kalanPlan, kalanVekalet)
  const tutarNum = body.tutar ?? maxTutar
  if (tutarNum <= 0 || tutarNum > maxTutar + 0.0001) {
    throw new AppError(400, 'Taksit tutarı geçersiz veya kalan vekalet tutarını aşıyor.', 'INVALID_AMOUNT')
  }

  const meta = getRequestMeta(req)
  const row = await prisma.$transaction(async (tx) => {
    const taksitNo = await nextTaksitNo(tx, vekalet.id)
    return tx.vekaletTaksiti.create({
      data: {
        tenantId,
        dosyaId,
        muvekkilId: dosya.muvekkilId,
        vekaletUcretiId: vekalet.id,
        taksitNo,
        vadeTarihi: body.vadeTarihi,
        tutar: new PrismaNamespace.Decimal(tutarNum),
        aciklama: body.aciklama?.trim() || null,
        createdById: userId
      }
    })
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_TAKSIT_CREATED',
    entityType: 'VekaletTaksiti',
    entityId: row.id,
    newValue: serializeVekaletTaksiti(row),
    meta: { dosyaId, tekTaksit: true },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
  return serializeVekaletTaksitiWithOzet(row, [])
}

export async function createVekaletTaksitPlani(
  tenantId: string,
  userId: string,
  dosyaId: string,
  body: CreateVekaletTaksitPlaniBody,
  req: Request
): Promise<Record<string, unknown>> {
  const dosya = await assertDosyaForVekalet(tenantId, dosyaId)
  if (!dosya) {
    throw new AppError(404, 'Dosya bulunamadı.', 'NOT_FOUND')
  }
  const vekalet = await prisma.vekaletUcreti.findUnique({
    where: { dosyaId },
    include: { taksitler: { where: { odemeDurumu: { not: 'IPTAL' } } } }
  })
  if (!vekalet) {
    throw new AppError(400, 'Önce vekalet ücreti tanımlanmalıdır.', 'VEKALET_REQUIRED')
  }

  const kalanPlan = kalanTaksitlendirmeTutari(vekalet.toplamTutar, vekalet.taksitler)
  if (kalanPlan <= 0.0001) {
    throw new AppError(400, 'Taksitlendirilebilir kalan tutar yok.', 'NO_REMAINING')
  }

  if (hasAcikVekaletTaksiti(vekalet.taksitler)) {
    throw new AppError(
      409,
      'Açık taksitler var. Taksit planı oluşturmak için önce mevcut açık taksitleri silin veya düzenleyin.',
      'OPEN_TAKSIT_CONFLICT'
    )
  }

  const tutarlar = hesaplaSabitTaksitPlani(Number(body.taksitTutari), body.taksitSayisi)
  if (!tutarlar || tutarlar.length === 0) {
    throw new AppError(400, 'Geçerli bir taksit planı oluşturulamadı.', 'INVALID_PLAN')
  }
  const planToplam = Math.round(tutarlar.reduce((s, t) => s + t, 0) * 100) / 100
  if (planToplam > kalanPlan + 0.005) {
    throw new AppError(
      400,
      `Plan toplamı (${planToplam.toFixed(2)}) kalan taksitlendirilebilir tutarı (${kalanPlan.toFixed(2)}) aşıyor.`,
      'PLAN_EXCEEDS_REMAINING'
    )
  }

  const meta = getRequestMeta(req)
  const created: VekaletTaksiti[] = []
  await prisma.$transaction(async (tx) => {
    let taksitNo = await nextTaksitNo(tx, vekalet.id)
    for (let i = 0; i < tutarlar.length; i++) {
      const row = await tx.vekaletTaksiti.create({
        data: {
          tenantId,
          dosyaId,
          muvekkilId: dosya.muvekkilId,
          vekaletUcretiId: vekalet.id,
          taksitNo,
          vadeTarihi: vadeEkleAy(body.ilkVadeTarihi, i),
          tutar: new PrismaNamespace.Decimal(tutarlar[i]),
          aciklama: body.aciklama?.trim() || null,
          createdById: userId
        }
      })
      created.push(row)
      taksitNo += 1
    }
  })

  for (const row of created) {
    await writeAuditLog({
      tenantId,
      userId,
      action: 'VEKALET_TAKSIT_CREATED',
      entityType: 'VekaletTaksiti',
      entityId: row.id,
      newValue: serializeVekaletTaksiti(row),
      meta: { dosyaId, taksitPlani: true },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
  }

  const pack = await getDosyaVekaletPackage(tenantId, dosyaId)
  return { ok: true, taksitler: pack?.taksitler ?? [], ozet: pack?.ozet }
}

export async function deleteVekaletTaksiti(
  tenantId: string,
  userId: string,
  taksitId: string,
  req: Request
): Promise<{ ok: true }> {
  const existing = await prisma.vekaletTaksiti.findFirst({
    where: { id: taksitId, tenantId },
    include: { odemeler: { select: { id: true } } }
  })
  if (!existing) {
    throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')
  }
  if (existing.odemeler.length > 0) {
    throw new AppError(400, 'Ödeme kaydı olan taksit silinemez.', 'HAS_PAYMENTS')
  }

  const meta = getRequestMeta(req)
  await prisma.vekaletTaksiti.delete({ where: { id: existing.id } })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_TAKSIT_DELETED',
    entityType: 'VekaletTaksiti',
    entityId: existing.id,
    oldValue: serializeVekaletTaksiti(existing),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
  return { ok: true }
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

  const odemeler = await prisma.vekaletTaksitOdeme.findMany({ where: { taksitId: existing.id } })
  const odenen = sumOdemeTutar(odemeler)

  if (body.tutar != null) {
    if (Number(body.tutar) < odenen - 0.0001) {
      throw new AppError(400, 'Taksit tutarı ödenen tutardan küçük olamaz.', 'INVALID_AMOUNT')
    }
    if (existing.odemeDurumu === 'ODENDI' && Math.abs(Number(body.tutar) - Number(existing.tutar)) > 0.0001) {
      throw new AppError(400, 'Tam ödenmiş taksitte tutar değiştirilemez.', 'INVALID_STATE')
    }
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

  return await serializeTaksitApiResponse(updated)
}

export async function markVekaletTaksitPaid(
  tenantId: string,
  userId: string,
  actorRole: UserRole,
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

  const odemeler = await prisma.vekaletTaksitOdeme.findMany({ where: { taksitId: existing.id } })
  const odenen = sumOdemeTutar(odemeler)
  const kalan = Math.max(0, Number(existing.tutar) - odenen)
  if (kalan <= 0.0001) {
    throw new AppError(400, 'Taksit zaten ödenmiş.', 'ALREADY_PAID')
  }

  const { createVekaletTaksitOdeme } = await import('./vekaletTaksitOdeme.service.js')
  return createVekaletTaksitOdeme(
    tenantId,
    userId,
    actorRole,
    taksitId,
    {
      tutar: kalan,
      odemeTarihi: body.odemeTarihi ?? new Date(),
      odemeYontemi: 'NAKIT',
      aciklama: body.aciklama ?? null,
      smmKesildiMi: false
    },
    req
  )
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

  return await serializeTaksitApiResponse(updated)
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

  return await serializeTaksitApiResponse(updated)
}
