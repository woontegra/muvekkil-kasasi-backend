import type { OdemeYontemi, Prisma, VekaletTaksiti } from '@prisma/client'
import { KasaHareketTipi, KasaOnayDurumu, Prisma as PrismaNamespace } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import type { CreateVekaletTaksitOdemeBody } from './vekalet.schemas.js'
import { serializeTenant } from '../auth/auth.service.js'
import { serializeMuvekkil } from '../muvekkil/muvekkil.service.js'
import { serializeDosya } from '../dosya/dosya.service.js'
import { getDosyaVekaletPackage, serializeVekaletTaksitiWithOzet, syncTaksitOdemeDurumu } from './vekalet.service.js'

export type TaksitDurumApi = 'ODENMEDI' | 'KISMI_ODENDI' | 'ODENDI' | 'GECIKTI'
export type SmmDurumApi = 'YOK' | 'BEKLIYOR' | 'KESILDI'

function decimalStr(d: Prisma.Decimal): string {
  return d.toFixed(2)
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
      vekaletUcreti: true
    }
  })
}

function sumOdemeler(odemeler: { tutar: Prisma.Decimal }[]): number {
  return odemeler.reduce((s, o) => s + Number(o.tutar), 0)
}

export async function createVekaletTaksitOdeme(
  tenantId: string,
  userId: string,
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

  const result = await prisma.$transaction(async (tx) => {
    const makbuzNo = await nextOdemeMakbuzNo(tx, tenantId, odemeTarihi)

    const kasa = await tx.kasaHareketi.create({
      data: {
        tenantId,
        dosyaId: taksit.dosyaId,
        muvekkilId: taksit.muvekkilId,
        tip: KasaHareketTipi.VEKALET_TAHSILAT,
        tarih: odemeTarihi,
        aciklama: `Vekalet taksit #${taksit.taksitNo} tahsilatı`,
        tutar,
        odemeYontemi: body.odemeYontemi,
        belgeNo: makbuzNo,
        onayDurumu: KasaOnayDurumu.ONAYSIZ,
        createdById: userId
      }
    })

    const odeme = await tx.vekaletTaksitOdeme.create({
      data: {
        tenantId,
        muvekkilId: taksit.muvekkilId,
        dosyaId: taksit.dosyaId,
        taksitId: taksit.id,
        odemeTarihi,
        tutar,
        odemeYontemi: body.odemeYontemi,
        aciklama,
        makbuzNo,
        smmKesildiMi: body.smmKesildiMi ?? false,
        kasaHareketId: kasa.id,
        createdById: userId
      }
    })

    const updatedTaksit = await syncTaksitOdemeDurumu(tx, taksit.id, userId)
    return { odeme, updatedTaksit }
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_TAKSIT_ODEME_CREATED',
    entityType: 'VekaletTaksitOdeme',
    entityId: result.odeme.id,
    newValue: serializeVekaletTaksitOdeme(result.odeme),
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
