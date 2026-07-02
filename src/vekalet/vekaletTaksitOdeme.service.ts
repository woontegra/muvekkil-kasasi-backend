import type { OdemeYontemi, OfisKasaOdemeYontemi, Prisma, UserRole } from '@prisma/client'
import { Prisma as PrismaNamespace } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import type { CreateVekaletPesinOdemeBody, CreateVekaletTaksitOdemeBody } from './vekalet.schemas.js'
import { serializeTenant } from '../auth/auth.service.js'
import { serializeMuvekkil } from '../muvekkil/muvekkil.service.js'
import { serializeDosya } from '../dosya/dosya.service.js'
import {
  getDosyaVekaletPackage,
  serializeVekaletTaksitiWithOzet,
  syncTaksitOdemeDurumu
} from './vekalet.service.js'
import { resolveTahsilatiYapanPersonel } from '../lib/tahsilatiYapanPersonel.js'
import {
  createOfisKasaGelirFromKaynakInTx,
  OFIS_KASA_KATEGORI_VEKALET_TAHSILATI,
  OFIS_KASA_KAYNAK_VEKALET_TAHSILATI
} from '../ofisKasa/ofisKasa.service.js'

export type TaksitDurumApi = 'ODENMEDI' | 'KISMI_ODENDI' | 'ODENDI' | 'GECIKTI'
export type SmmDurumApi = 'YOK' | 'BEKLIYOR' | 'KESILDI'

function decimalStr(d: Prisma.Decimal): string {
  return d.toFixed(2)
}

function toOfisOdemeYontemi(y: OdemeYontemi): OfisKasaOdemeYontemi {
  return y as OfisKasaOdemeYontemi
}

function vekaletOfisAciklama(muvekkilAd: string, dosyaKonu: string, taksitNo?: number): string {
  const base = `Vekalet tahsilatı - ${muvekkilAd} - ${dosyaKonu}`
  if (taksitNo != null) return `${base} - Taksit No: ${taksitNo}`
  return base
}

export function serializeVekaletTaksitOdeme(o: {
  id: string
  tenantId: string
  muvekkilId: string
  dosyaId: string
  taksitId: string
  odemeTarihi: Date
  tutar: Prisma.Decimal
  odemeYontemi: OdemeYontemi
  aciklama: string | null
  makbuzNo: string
  smmKesildiMi: boolean
  kasaHareketId: string | null
  ofisKasaHareketId: string | null
  tahsilatiYapanUserId: string | null
  tahsilatiYapanPersonelId: string | null
  createdById: string
  createdAt: Date
  updatedAt: Date
}): Record<string, unknown> {
  return {
    id: o.id,
    tenantId: o.tenantId,
    muvekkilId: o.muvekkilId,
    dosyaId: o.dosyaId,
    taksitId: o.taksitId,
    odemeTarihi: o.odemeTarihi.toISOString(),
    tutar: decimalStr(o.tutar),
    odemeYontemi: o.odemeYontemi,
    aciklama: o.aciklama,
    makbuzNo: o.makbuzNo,
    smmKesildiMi: o.smmKesildiMi,
    kasaHareketId: o.kasaHareketId,
    ofisKasaHareketId: o.ofisKasaHareketId,
    tahsilatiYapanUserId: o.tahsilatiYapanUserId,
    tahsilatiYapanPersonelId: o.tahsilatiYapanPersonelId,
    createdById: o.createdById,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString()
  }
}

async function nextOdemeMakbuzNo(tx: Prisma.TransactionClient, tenantId: string, tarihRef: Date): Promise<string> {
  const year = tarihRef.getFullYear()
  const prefix = `VEK-${year}-`
  const [lastTaksit, lastOdeme] = await Promise.all([
    tx.vekaletTaksiti.findFirst({
      where: { tenantId, makbuzNo: { startsWith: prefix } },
      orderBy: { makbuzNo: 'desc' },
      select: { makbuzNo: true }
    }),
    tx.vekaletTaksitOdeme.findFirst({
      where: { tenantId, makbuzNo: { startsWith: prefix } },
      orderBy: { makbuzNo: 'desc' },
      select: { makbuzNo: true }
    })
  ])
  let n = 1
  for (const row of [lastTaksit?.makbuzNo, lastOdeme?.makbuzNo]) {
    if (!row) continue
    const parts = row.split('-')
    const num = parseInt(parts[2] ?? '0', 10)
    if (!Number.isNaN(num) && num >= n) n = num + 1
  }
  return `${prefix}${String(n).padStart(6, '0')}`
}

async function getTaksitWithOdemeler(tenantId: string, taksitId: string) {
  return prisma.vekaletTaksiti.findFirst({
    where: { id: taksitId, tenantId },
    include: {
      odemeler: { orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }] },
      vekaletUcreti: true,
      dosya: { select: { konuBasligi: true } },
      muvekkil: { select: { gorunenAd: true } }
    }
  })
}

function sumOdemeler(odemeler: { tutar: Prisma.Decimal }[]): number {
  return odemeler.reduce((s, o) => s + Number(o.tutar), 0)
}

type OdemeCreateCtx = {
  tenantId: string
  userId: string
  taksit: {
    id: string
    dosyaId: string
    muvekkilId: string
    taksitNo: number
    tutar: Prisma.Decimal
    odemeler: { tutar: Prisma.Decimal }[]
    dosya: { konuBasligi: string }
    muvekkil: { gorunenAd: string }
  }
  tutar: Prisma.Decimal
  odemeTarihi: Date
  odemeYontemi: OdemeYontemi
  aciklama: string | null
  tahsilatiPersonelId: string | null
  tahsilatiUserId: string | null
}

async function createVekaletOdemeInTx(tx: Prisma.TransactionClient, ctx: OdemeCreateCtx) {
  const makbuzNo = await nextOdemeMakbuzNo(tx, ctx.tenantId, ctx.odemeTarihi)

  const odeme = await tx.vekaletTaksitOdeme.create({
    data: {
      tenantId: ctx.tenantId,
      muvekkilId: ctx.taksit.muvekkilId,
      dosyaId: ctx.taksit.dosyaId,
      taksitId: ctx.taksit.id,
      odemeTarihi: ctx.odemeTarihi,
      tutar: ctx.tutar,
      odemeYontemi: ctx.odemeYontemi,
      aciklama: ctx.aciklama,
      makbuzNo,
      smmKesildiMi: false,
      tahsilatiYapanPersonelId: ctx.tahsilatiPersonelId,
      tahsilatiYapanUserId: ctx.tahsilatiUserId,
      createdById: ctx.userId
    }
  })

  const ofis = await createOfisKasaGelirFromKaynakInTx(tx, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    tarih: ctx.odemeTarihi,
    kategori: OFIS_KASA_KATEGORI_VEKALET_TAHSILATI,
    aciklama: vekaletOfisAciklama(
      ctx.taksit.muvekkil.gorunenAd,
      ctx.taksit.dosya.konuBasligi,
      ctx.taksit.taksitNo
    ),
    tutar: ctx.tutar,
    odemeYontemi: toOfisOdemeYontemi(ctx.odemeYontemi),
    tahsilatiYapanPersonelId: ctx.tahsilatiPersonelId,
    tahsilatiYapanUserId: ctx.tahsilatiUserId,
    kaynakTipi: OFIS_KASA_KAYNAK_VEKALET_TAHSILATI,
    kaynakId: odeme.id
  })

  const linked = await tx.vekaletTaksitOdeme.update({
    where: { id: odeme.id },
    data: { ofisKasaHareketId: ofis.id }
  })

  await syncTaksitOdemeDurumu(tx, ctx.taksit.id, ctx.userId)
  return linked
}

export async function createVekaletTaksitOdeme(
  tenantId: string,
  userId: string,
  actorRole: UserRole,
  taksitId: string,
  body: CreateVekaletTaksitOdemeBody,
  req: Request
): Promise<Record<string, unknown>> {
  const taksit = await getTaksitWithOdemeler(tenantId, taksitId)
  if (!taksit) {
    throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')
  }
  if (taksit.odemeDurumu === 'IPTAL') {
    throw new AppError(400, 'İptal edilmiş taksit için ödeme alınamaz.', 'INVALID_STATE')
  }

  const tutar = new PrismaNamespace.Decimal(body.tutar)
  const odenen = sumOdemeler(taksit.odemeler)
  const taksitTutari = Number(taksit.tutar)
  const kalan = Math.max(0, taksitTutari - odenen)

  if (Number(tutar) > kalan + 0.0001) {
    throw new AppError(400, 'Ödeme tutarı kalan taksit tutarını aşamaz.', 'TAKSIT_OVERPAYMENT')
  }

  const meta = getRequestMeta(req)
  const odemeTarihi = body.odemeTarihi ?? new Date()
  const aciklama = body.aciklama?.trim() || null
  const tahsilati = await resolveTahsilatiYapanPersonel(
    tenantId,
    userId,
    actorRole,
    body.tahsilatiYapanPersonelId ?? body.tahsilatiYapanUserId
  )

  const result = await prisma.$transaction(async (tx) => {
    const odeme = await createVekaletOdemeInTx(tx, {
      tenantId,
      userId,
      taksit,
      tutar,
      odemeTarihi,
      odemeYontemi: body.odemeYontemi,
      aciklama,
      tahsilatiPersonelId: tahsilati.personelId,
      tahsilatiUserId: tahsilati.bagliUserId
    })
    return odeme
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_TAKSIT_ODEME_CREATED',
    entityType: 'VekaletTaksitOdeme',
    entityId: result.id,
    newValue: serializeVekaletTaksitOdeme(result),
    meta: { taksitId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  const fresh = await getTaksitWithOdemeler(tenantId, taksitId)
  if (!fresh) {
    throw new AppError(500, 'Taksit güncellenemedi.', 'INTERNAL')
  }

  return serializeVekaletTaksitiWithOzet(fresh, fresh.odemeler)
}

export async function createVekaletPesinOdeme(
  tenantId: string,
  userId: string,
  actorRole: UserRole,
  dosyaId: string,
  body: CreateVekaletPesinOdemeBody,
  req: Request
): Promise<Record<string, unknown>> {
  const pack = await getDosyaVekaletPackage(tenantId, dosyaId)
  if (!pack?.vekaletUcreti) {
    throw new AppError(400, 'Önce vekalet ücreti tanımlanmalıdır.', 'VEKALET_REQUIRED')
  }

  const kalanVekalet = Number(pack.ozet.kalanVekalet)
  const tutarNum = Number(body.tutar)
  if (tutarNum <= 0) {
    throw new AppError(400, 'Tutar 0\'dan büyük olmalıdır.', 'INVALID_AMOUNT')
  }
  if (tutarNum > kalanVekalet + 0.0001) {
    throw new AppError(400, 'Tutar kalan vekaleti aşamaz.', 'OVERPAYMENT')
  }

  const taksitler = await prisma.vekaletTaksiti.findMany({
    where: {
      tenantId,
      dosyaId,
      odemeDurumu: { in: ['ODENMEDI', 'KISMI_ODENDI'] }
    },
    include: {
      odemeler: { orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }] },
      dosya: { select: { konuBasligi: true } },
      muvekkil: { select: { gorunenAd: true } }
    },
    orderBy: [{ vadeTarihi: 'asc' }, { taksitNo: 'asc' }]
  })

  if (taksitler.length === 0) {
    throw new AppError(
      400,
      'Peşin ödeme dağıtımı için açık taksit bulunamadı. Önce tek taksit veya taksit planı oluşturun.',
      'NO_OPEN_TAKSIT'
    )
  }

  const meta = getRequestMeta(req)
  const odemeTarihi = body.odemeTarihi ?? new Date()
  const aciklama = body.aciklama?.trim() || null
  const tahsilati = await resolveTahsilatiYapanPersonel(
    tenantId,
    userId,
    actorRole,
    body.tahsilatiYapanPersonelId ?? body.tahsilatiYapanUserId
  )

  let remaining = tutarNum
  const createdIds: string[] = []

  await prisma.$transaction(async (tx) => {
    for (const t of taksitler) {
      if (remaining <= 0.0001) break
      const odenen = sumOdemeler(t.odemeler)
      const kalan = Math.max(0, Number(t.tutar) - odenen)
      if (kalan <= 0.0001) continue
      const pay = Math.min(remaining, kalan)
      const odeme = await createVekaletOdemeInTx(tx, {
        tenantId,
        userId,
        taksit: t,
        tutar: new PrismaNamespace.Decimal(pay),
        odemeTarihi,
        odemeYontemi: body.odemeYontemi,
        aciklama,
        tahsilatiPersonelId: tahsilati.personelId,
        tahsilatiUserId: tahsilati.bagliUserId
      })
      createdIds.push(odeme.id)
      remaining = Math.round((remaining - pay) * 100) / 100
    }
    if (remaining > 0.0001) {
      throw new AppError(400, 'Ödeme tutarı için yeterli açık taksit kalanı yok.', 'INSUFFICIENT_OPEN_TAKSIT')
    }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_PESIN_ODEME_CREATED',
    entityType: 'VekaletTaksitOdeme',
    entityId: createdIds[0] ?? dosyaId,
    newValue: { tutar: body.tutar, odemeIds: createdIds },
    meta: { dosyaId, odemeCount: createdIds.length },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  const freshPack = await getDosyaVekaletPackage(tenantId, dosyaId)
  if (!freshPack) {
    throw new AppError(500, 'Vekalet güncellenemedi.', 'INTERNAL')
  }
  return {
    ok: true,
    odemeIds: createdIds,
    ozet: freshPack.ozet,
    taksitler: freshPack.taksitler
  }
}

export async function listVekaletTaksitOdemeler(
  tenantId: string,
  taksitId: string
): Promise<Record<string, unknown>[] | null> {
  const taksit = await prisma.vekaletTaksiti.findFirst({
    where: { id: taksitId, tenantId },
    select: { id: true }
  })
  if (!taksit) return null

  const rows = await prisma.vekaletTaksitOdeme.findMany({
    where: { tenantId, taksitId },
    orderBy: [{ odemeTarihi: 'desc' }, { createdAt: 'desc' }]
  })
  return rows.map(serializeVekaletTaksitOdeme)
}

export async function markVekaletTaksitOdemeSmm(
  tenantId: string,
  userId: string,
  odemeId: string,
  req: Request
): Promise<Record<string, unknown>> {
  const existing = await prisma.vekaletTaksitOdeme.findFirst({
    where: { id: odemeId, tenantId }
  })
  if (!existing) {
    throw new AppError(404, 'Ödeme kaydı bulunamadı.', 'NOT_FOUND')
  }
  if (existing.smmKesildiMi) {
    return serializeVekaletTaksitOdeme(existing)
  }

  const meta = getRequestMeta(req)
  const updated = await prisma.vekaletTaksitOdeme.update({
    where: { id: existing.id },
    data: { smmKesildiMi: true }
  })

  await prisma.$transaction(async (tx) => {
    await syncTaksitOdemeDurumu(tx, existing.taksitId, userId)
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_TAKSIT_ODEME_SMM_MARKED',
    entityType: 'VekaletTaksitOdeme',
    entityId: updated.id,
    oldValue: serializeVekaletTaksitOdeme(existing),
    newValue: serializeVekaletTaksitOdeme(updated),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeVekaletTaksitOdeme(updated)
}

export async function getVekaletTaksitOdemeMakbuz(
  tenantId: string,
  odemeId: string
): Promise<Record<string, unknown> | null> {
  const odeme = await prisma.vekaletTaksitOdeme.findFirst({
    where: { id: odemeId, tenantId },
    include: {
      taksit: { include: { vekaletUcreti: true } },
      dosya: true,
      muvekkil: true,
      tenant: true
    }
  })
  if (!odeme) return null

  const pack = await getDosyaVekaletPackage(tenantId, odeme.dosyaId)
  const taksitOzet = pack?.taksitler.find((t) => t.id === odeme.taksitId) ?? null

  return {
    buro: serializeTenant(odeme.tenant),
    muvekkil: serializeMuvekkil(odeme.muvekkil),
    dosya: serializeDosya(odeme.dosya),
    mahkemeIcra: odeme.dosya.mahkeme?.trim() || odeme.dosya.icraDairesi?.trim() || null,
    dosyaNo: odeme.dosya.dosyaNo,
    taksitNo: odeme.taksit.taksitNo,
    taksitTutari: decimalStr(odeme.taksit.tutar),
    odemeTarihi: odeme.odemeTarihi.toISOString(),
    odemeYontemi: odeme.odemeYontemi,
    tahsilatTutari: decimalStr(odeme.tutar),
    anlasilanVekalet: pack?.ozet.anlasilan ?? decimalStr(odeme.taksit.vekaletUcreti.toplamTutar),
    odenenToplam: pack?.ozet.odenenToplam ?? '0.00',
    kalanVekalet: pack?.ozet.kalanVekalet ?? '0.00',
    makbuzNo: odeme.makbuzNo,
    smmKesildiMi: odeme.smmKesildiMi,
    taksitOzet,
    odeme: serializeVekaletTaksitOdeme(odeme)
  }
}
