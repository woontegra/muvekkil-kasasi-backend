import type { OdemeYontemi, OfisKasaOdemeYontemi, ParaBirimi, Prisma, UserRole } from '@prisma/client'
import { OfisKasaOnayDurumu, Prisma as PrismaNamespace } from '@prisma/client'
import {
  formatMoneyDisplay,
  rateToApiString,
  resolveParaBirimi,
  resolvePaymentAmounts,
  type ResolvedPayment
} from '../lib/paraBirimi.js'
import { resolvePaymentKurSnapshot } from '../lib/kurSnapshot.js'
import { prisma } from '../lib/prisma.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import type {
  CreateVekaletPesinOdemeBody,
  CreateVekaletTaksitOdemeBody,
  UpdateVekaletTaksitOdemeBody
} from './vekalet.schemas.js'
import { serializeTenant } from '../auth/auth.service.js'
import { serializeMuvekkil } from '../muvekkil/muvekkil.service.js'
import { serializeDosya } from '../dosya/dosya.service.js'
import {
  getDosyaVekaletPackage,
  serializeVekaletTaksitiWithOzet,
  syncTaksitOdemeDurumu
} from './vekalet.service.js'
import {
  assertExpectedKalanMatches,
  computeTaksitOdemeOzeti,
  filterAktifTahsilatOdemeleri
} from './taksitOdemeOzet.js'
import { resolveTahsilatiYapanPersonel } from '../lib/tahsilatiYapanPersonel.js'
import {
  createOfisKasaGelirFromKaynakInTx,
  OFIS_KASA_KATEGORI_VEKALET_TAHSILATI,
  OFIS_KASA_KAYNAK_VEKALET_TAHSILATI
} from '../ofisKasa/ofisKasa.service.js'
import { onTaksitOdemeChanged } from '../tahsilatBildirim/sync.service.js'

export type TaksitDurumApi = 'ODENMEDI' | 'KISMI_ODENDI' | 'ODENDI' | 'GECIKTI'
export type SmmDurumApi = 'YOK' | 'BEKLIYOR' | 'KESILDI'

function decimalStr(d: Prisma.Decimal): string {
  return d.toFixed(2)
}

function toOfisOdemeYontemi(y: OdemeYontemi): OfisKasaOdemeYontemi {
  return y as OfisKasaOdemeYontemi
}

/** Onaylı ofis kasa hareketi bağlı tahsilat doğrudan güncellenemez. */
export function assertOfisHareketGuncellenebilir(
  ofis: { onayDurumu: string } | null | undefined
): void {
  if (ofis?.onayDurumu === OfisKasaOnayDurumu.ONAYLI) {
    throw new AppError(
      409,
      'Onaylanmış tahsilat doğrudan değiştirilemez. Önce mevcut tahsilatı güvenli biçimde silip doğru bilgilerle yeniden kaydedin.',
      'ONAYLI_TAHSILAT_LOCKED'
    )
  }
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
  kasaTutari: Prisma.Decimal
  alacakParaBirimi: ParaBirimi
  odemeParaBirimi: ParaBirimi
  kur?: Prisma.Decimal | null
  kurBazParaBirimi?: ParaBirimi | null
  kurKarsiParaBirimi?: ParaBirimi | null
  kurKaynagi?: string | null
  tcmbKurTarihi?: Date | null
  tcmbReferansKur?: Prisma.Decimal | null
  primTryMatrahi?: Prisma.Decimal | null
  odemeYontemi: OdemeYontemi
  aciklama: string | null
  makbuzNo: string
  makbuzDurumu?: string
  smmKesildiMi: boolean
  iptalAt?: Date | null
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
    kasaTutari: decimalStr(o.kasaTutari),
    alacakParaBirimi: o.alacakParaBirimi,
    odemeParaBirimi: o.odemeParaBirimi,
    kur: rateToApiString(o.kur),
    kurBazParaBirimi: o.kurBazParaBirimi ?? null,
    kurKarsiParaBirimi: o.kurKarsiParaBirimi ?? null,
    kurKaynagi: o.kurKaynagi ?? null,
    tcmbKurTarihi: o.tcmbKurTarihi ? o.tcmbKurTarihi.toISOString().slice(0, 10) : null,
    tcmbReferansKur: rateToApiString(o.tcmbReferansKur),
    primTryMatrahi: o.primTryMatrahi != null ? decimalStr(o.primTryMatrahi) : null,
    odemeYontemi: o.odemeYontemi,
    aciklama: o.aciklama,
    makbuzNo: o.makbuzNo,
    makbuzDurumu: o.makbuzDurumu ?? 'AKTIF',
    smmKesildiMi: o.smmKesildiMi,
    iptalAt: o.iptalAt ? o.iptalAt.toISOString() : null,
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
      odemeler: {
        orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }],
        include: odemeAktiflikInclude
      },
      vekaletUcreti: true,
      dosya: { select: { konuBasligi: true } },
      muvekkil: { select: { gorunenAd: true } }
    }
  })
}

const odemeAktiflikInclude = {
  ofisKasaHareket: { select: { deletedAt: true as const } }
} as const

type OdemeCreateCtx = {
  tenantId: string
  userId: string
  taksit: {
    id: string
    dosyaId: string
    muvekkilId: string
    taksitNo: number
    tutar: Prisma.Decimal
    paraBirimi: ParaBirimi
    odemeler: { tutar: Prisma.Decimal }[]
    dosya: { konuBasligi: string }
    muvekkil: { gorunenAd: string }
  }
  payment: ResolvedPayment
  kurMeta: {
    kurKaynagi: import('@prisma/client').KurKaynagi | null
    tcmbKurTarihi: Date | null
    tcmbReferansKur: Prisma.Decimal | null
    primTryMatrahi: Prisma.Decimal
  }
  odemeTarihi: Date
  odemeYontemi: OdemeYontemi
  aciklama: string | null
  tahsilatiPersonelId: string | null
  tahsilatiUserId: string | null
}

async function createVekaletOdemeInTx(tx: Prisma.TransactionClient, ctx: OdemeCreateCtx) {
  const makbuzNo = await nextOdemeMakbuzNo(tx, ctx.tenantId, ctx.odemeTarihi)
  const p = ctx.payment
  const km = ctx.kurMeta

  const odeme = await tx.vekaletTaksitOdeme.create({
    data: {
      tenantId: ctx.tenantId,
      muvekkilId: ctx.taksit.muvekkilId,
      dosyaId: ctx.taksit.dosyaId,
      taksitId: ctx.taksit.id,
      odemeTarihi: ctx.odemeTarihi,
      tutar: p.mahsupTutari,
      kasaTutari: p.kasaTutari,
      alacakParaBirimi: p.alacakParaBirimi,
      odemeParaBirimi: p.odemeParaBirimi,
      kur: p.kur,
      kurBazParaBirimi: p.kurBazParaBirimi,
      kurKarsiParaBirimi: p.kurKarsiParaBirimi,
      kurKaynagi: km.kurKaynagi,
      tcmbKurTarihi: km.tcmbKurTarihi,
      tcmbReferansKur: km.tcmbReferansKur,
      primTryMatrahi: km.primTryMatrahi,
      odemeYontemi: ctx.odemeYontemi,
      aciklama: ctx.aciklama,
      makbuzNo,
      smmKesildiMi: false,
      tahsilatiYapanPersonelId: ctx.tahsilatiPersonelId,
      tahsilatiYapanUserId: ctx.tahsilatiUserId,
      createdById: ctx.userId
    }
  })

  const ofisAciklamaBase = vekaletOfisAciklama(
    ctx.taksit.muvekkil.gorunenAd,
    ctx.taksit.dosya.konuBasligi,
    ctx.taksit.taksitNo
  )
  const ofisAciklamaFull =
    p.isCrossCurrency && p.kurOzeti
      ? `${ofisAciklamaBase} (${p.kurOzeti})`
      : ofisAciklamaBase

  const ofis = await createOfisKasaGelirFromKaynakInTx(tx, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    tarih: ctx.odemeTarihi,
    kategori: OFIS_KASA_KATEGORI_VEKALET_TAHSILATI,
    aciklama: ofisAciklamaFull,
    kasaTutari: p.kasaTutari,
    paraBirimi: p.odemeParaBirimi,
    kur: p.kur,
    kurBazParaBirimi: p.kurBazParaBirimi,
    kurKarsiParaBirimi: p.kurKarsiParaBirimi,
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
  const head = await prisma.vekaletTaksiti.findFirst({
    where: { id: taksitId, tenantId },
    select: { id: true, odemeDurumu: true }
  })
  if (!head) {
    throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')
  }
  if (head.odemeDurumu === 'IPTAL') {
    throw new AppError(400, 'İptal edilmiş taksit için ödeme alınamaz.', 'INVALID_STATE')
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

  /** Kalan borç kontrolü satır kilidi içinde — eşzamanlı çift ödeme aşımı engellenir. */
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT id FROM "vekalet_taksiti"
        WHERE id = ${taksitId} AND tenant_id = ${tenantId}
        FOR UPDATE
      `
      const taksit = await tx.vekaletTaksiti.findFirst({
        where: { id: taksitId, tenantId },
        include: {
          odemeler: {
            orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }],
            include: odemeAktiflikInclude
          },
          vekaletUcreti: true,
          dosya: { select: { konuBasligi: true } },
          muvekkil: { select: { gorunenAd: true } }
        }
      })
      if (!taksit) {
        throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')
      }
      if (taksit.odemeDurumu === 'IPTAL') {
        throw new AppError(400, 'İptal edilmiş taksit için ödeme alınamaz.', 'INVALID_STATE')
      }
      const alacakParaBirimi = taksit.paraBirimi ?? taksit.vekaletUcreti.paraBirimi
      const ozet = computeTaksitOdemeOzeti(taksit.tutar, taksit.odemeler)
      assertExpectedKalanMatches(body.expectedKalanTutar, ozet, alacakParaBirimi)
      const payment = resolvePaymentAmounts({
        alacakParaBirimi,
        mahsupTutari: body.tutar,
        odemeParaBirimi: body.odemeParaBirimi,
        kasaTutari: body.kasaTutari,
        kalanBorc: ozet.kalanTutar
      })
      const kurMeta = await resolvePaymentKurSnapshot({
        odemeTarihi,
        payment,
        kurKaynagi: body.kurKaynagi,
        tcmbKurTarihi: body.tcmbKurTarihi,
        tcmbReferansKur: body.tcmbReferansKur
      })

      return createVekaletOdemeInTx(tx, {
        tenantId,
        userId,
        taksit: { ...taksit, paraBirimi: alacakParaBirimi },
        payment,
        kurMeta,
        odemeTarihi,
        odemeYontemi: body.odemeYontemi,
        aciklama,
        tahsilatiPersonelId: tahsilati.personelId,
        tahsilatiUserId: tahsilati.bagliUserId
      })
    },
    { maxWait: 15_000, timeout: 30_000 }
  )

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

  void onTaksitOdemeChanged(tenantId, taksitId).catch(() => {})

  return serializeVekaletTaksitiWithOzet(fresh, filterAktifTahsilatOdemeleri(fresh.odemeler))
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
  const alacakParaBirimi = resolveParaBirimi(
    typeof pack.vekaletUcreti?.paraBirimi === 'string' ? pack.vekaletUcreti.paraBirimi : undefined
  )
  const totalPayment = resolvePaymentAmounts({
    alacakParaBirimi,
    mahsupTutari: body.tutar,
    odemeParaBirimi: body.odemeParaBirimi,
    kasaTutari: body.kasaTutari,
    kalanBorc: new PrismaNamespace.Decimal(kalanVekalet)
  })
  const tutarNum = Number(totalPayment.mahsupTutari)

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

  await prisma.$transaction(
    async (tx) => {
      // Açık taksitleri kilitle — peşin dağıtımında eşzamanlı aşımı önler
      await tx.$executeRaw`
        SELECT id FROM "vekalet_taksiti"
        WHERE tenant_id = ${tenantId} AND dosya_id = ${dosyaId}
          AND odeme_durumu IN ('ODENMEDI', 'KISMI_ODENDI')
        ORDER BY vade_tarihi ASC, taksit_no ASC
        FOR UPDATE
      `
      const locked = await tx.vekaletTaksiti.findMany({
        where: {
          tenantId,
          dosyaId,
          odemeDurumu: { in: ['ODENMEDI', 'KISMI_ODENDI'] }
        },
        include: {
          odemeler: {
            orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }],
            include: odemeAktiflikInclude
          },
          dosya: { select: { konuBasligi: true } },
          muvekkil: { select: { gorunenAd: true } }
        },
        orderBy: [{ vadeTarihi: 'asc' }, { taksitNo: 'asc' }]
      })
      for (const t of locked) {
        if (remaining <= 0.0001) break
        const ozet = computeTaksitOdemeOzeti(t.tutar, t.odemeler)
        const kalan = Number(ozet.kalanTutar)
        if (kalan <= 0.0001) continue
        const pay = Math.min(remaining, kalan)
        const payRatio = tutarNum > 0 ? pay / tutarNum : 1
        const sliceKasa = totalPayment.kasaTutari.mul(payRatio).toDecimalPlaces(2, PrismaNamespace.Decimal.ROUND_HALF_UP)
        const slicePayment = resolvePaymentAmounts({
          alacakParaBirimi,
          mahsupTutari: pay,
          odemeParaBirimi: totalPayment.odemeParaBirimi,
          kasaTutari: sliceKasa,
          kalanBorc: new PrismaNamespace.Decimal(kalan)
        })
        const kurMeta = await resolvePaymentKurSnapshot({
          odemeTarihi,
          payment: slicePayment,
          kurKaynagi: body.kurKaynagi,
          tcmbKurTarihi: body.tcmbKurTarihi,
          tcmbReferansKur: body.tcmbReferansKur
        })
        const odeme = await createVekaletOdemeInTx(tx, {
          tenantId,
          userId,
          taksit: { ...t, paraBirimi: alacakParaBirimi },
          payment: slicePayment,
          kurMeta,
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
    },
    { maxWait: 15_000, timeout: 45_000 }
  )

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

export async function updateVekaletTaksitOdeme(
  tenantId: string,
  userId: string,
  odemeId: string,
  body: UpdateVekaletTaksitOdemeBody,
  req: Request
): Promise<Record<string, unknown>> {
  const existing = await prisma.vekaletTaksitOdeme.findFirst({
    where: { id: odemeId, tenantId },
    include: {
      taksit: {
        include: {
          odemeler: { orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }] },
          vekaletUcreti: true
        }
      },
      ofisKasaHareket: {
        select: {
          onayDurumu: true,
          kurKaynagi: true,
          tcmbKurTarihi: true,
          tcmbReferansKur: true
        }
      }
    }
  })
  if (!existing) {
    throw new AppError(404, 'Ödeme kaydı bulunamadı.', 'NOT_FOUND')
  }
  if (existing.taksit.odemeDurumu === 'IPTAL') {
    throw new AppError(400, 'İptal edilmiş taksit ödemesi düzenlenemez.', 'INVALID_STATE')
  }
  assertOfisHareketGuncellenebilir(existing.ofisKasaHareket)

  const meta = getRequestMeta(req)
  const odemeTarihi = body.odemeTarihi ?? existing.odemeTarihi
  const odemeYontemi = body.odemeYontemi ?? existing.odemeYontemi
  const aciklama =
    body.aciklama === undefined ? existing.aciklama : body.aciklama?.trim() || null

  const updated = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT id FROM "vekalet_taksiti"
        WHERE id = ${existing.taksitId} AND tenant_id = ${tenantId}
        FOR UPDATE
      `
      const freshOdemeler = await tx.vekaletTaksitOdeme.findMany({
        where: { tenantId, taksitId: existing.taksitId },
        include: odemeAktiflikInclude
      })
      const alacakParaBirimi = existing.taksit.paraBirimi ?? existing.taksit.vekaletUcreti.paraBirimi
      const ozet = computeTaksitOdemeOzeti(existing.taksit.tutar, freshOdemeler, {
        excludeOdemeId: existing.id
      })
      const mahsupRaw = body.tutar != null ? body.tutar : existing.tutar
      const payment = resolvePaymentAmounts({
        alacakParaBirimi,
        mahsupTutari: mahsupRaw,
        odemeParaBirimi: body.odemeParaBirimi ?? existing.odemeParaBirimi,
        kasaTutari: body.kasaTutari ?? existing.kasaTutari,
        kalanBorc: ozet.kalanTutar
      })

      // TCMB snapshot alanları oluşturma anında sabitlenir; güncellemede
      // canlı kur ile yeniden yazılmaz (geçmiş tahsilat değişmesin).
      const row = await tx.vekaletTaksitOdeme.update({
        where: { id: existing.id },
        data: {
          tutar: payment.mahsupTutari,
          kasaTutari: payment.kasaTutari,
          alacakParaBirimi: payment.alacakParaBirimi,
          odemeParaBirimi: payment.odemeParaBirimi,
          kur: payment.kur,
          kurBazParaBirimi: payment.kurBazParaBirimi,
          kurKarsiParaBirimi: payment.kurKarsiParaBirimi,
          kurKaynagi: existing.kurKaynagi,
          tcmbKurTarihi: existing.tcmbKurTarihi,
          tcmbReferansKur: existing.tcmbReferansKur,
          primTryMatrahi: existing.primTryMatrahi,
          odemeTarihi,
          odemeYontemi,
          aciklama
        }
      })

      if (existing.ofisKasaHareketId) {
        await tx.ofisKasaHareketi.update({
          where: { id: existing.ofisKasaHareketId },
          data: {
            tutar: payment.kasaTutari,
            paraBirimi: payment.odemeParaBirimi,
            kur: payment.kur,
            kurBazParaBirimi: payment.kurBazParaBirimi,
            kurKarsiParaBirimi: payment.kurKarsiParaBirimi,
            kurKaynagi: existing.ofisKasaHareket?.kurKaynagi ?? existing.kurKaynagi,
            tcmbKurTarihi: existing.ofisKasaHareket?.tcmbKurTarihi ?? existing.tcmbKurTarihi,
            tcmbReferansKur:
              existing.ofisKasaHareket?.tcmbReferansKur ?? existing.tcmbReferansKur,
            tarih: odemeTarihi,
            odemeYontemi: toOfisOdemeYontemi(odemeYontemi),
            updatedById: userId
          }
        })
      }

      await syncTaksitOdemeDurumu(tx, existing.taksitId, userId)
      return row
    },
    { maxWait: 15_000, timeout: 30_000 }
  )

  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_TAKSIT_ODEME_UPDATED',
    entityType: 'VekaletTaksitOdeme',
    entityId: updated.id,
    oldValue: serializeVekaletTaksitOdeme(existing),
    newValue: serializeVekaletTaksitOdeme(updated),
    meta: { taksitId: existing.taksitId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  void onTaksitOdemeChanged(tenantId, existing.taksitId).catch(() => {})

  return serializeVekaletTaksitOdeme(updated)
}

export async function deleteVekaletTaksitOdeme(
  tenantId: string,
  userId: string,
  odemeId: string,
  req: Request
): Promise<{ ok: true; taksitId: string }> {
  const existing = await prisma.vekaletTaksitOdeme.findFirst({
    where: { id: odemeId, tenantId },
    include: { ofisKasaHareket: true }
  })
  if (!existing) {
    throw new AppError(404, 'Ödeme kaydı bulunamadı.', 'NOT_FOUND')
  }

  const ofisId = existing.ofisKasaHareketId

  if (existing.ofisKasaHareket?.onayDurumu === OfisKasaOnayDurumu.ONAYLI) {
    throw new AppError(
      400,
      'Onaylı ofis kasa hareketi olan tahsilat silinemez. Önce ofis kasasında ilgili kaydı geri alın.',
      'OFIS_KASA_APPROVED'
    )
  }

  if (ofisId) {
    const linkedDuzeltme = await prisma.ofisKasaHareketi.count({
      where: { tenantId, orijinalHareketId: ofisId }
    })
    if (linkedDuzeltme > 0) {
      throw new AppError(
        400,
        'Bu tahsilata bağlı ofis kasa düzeltmesi bulunduğu için silinemez.',
        'OFIS_KASA_HAS_DUZELTME'
      )
    }
  }

  const meta = getRequestMeta(req)
  const taksitId = existing.taksitId

  await prisma.$transaction(async (tx) => {
    await tx.vekaletTaksitOdeme.update({
      where: { id: existing.id },
      data: { ofisKasaHareketId: null }
    })
    if (ofisId) {
      await tx.ofisKasaHareketi.delete({ where: { id: ofisId } })
    }
    await tx.vekaletTaksitOdeme.delete({ where: { id: existing.id } })
    await syncTaksitOdemeDurumu(tx, taksitId, userId)
  })

  await writeAuditLog({
    tenantId,
    userId,
    action: 'VEKALET_TAKSIT_ODEME_DELETED',
    entityType: 'VekaletTaksitOdeme',
    entityId: odemeId,
    oldValue: serializeVekaletTaksitOdeme(existing),
    meta: { taksitId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  void onTaksitOdemeChanged(tenantId, taksitId).catch(() => {})

  return { ok: true, taksitId }
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
  const taksitOdenen =
    typeof taksitOzet?.odenenToplam === 'string' ? taksitOzet.odenenToplam : '0.00'
  const taksitKalan =
    typeof taksitOzet?.kalanTutar === 'string' ? taksitOzet.kalanTutar : '0.00'
  const taksitDurum =
    typeof taksitOzet?.durum === 'string' ? taksitOzet.durum : null

  return {
    buro: serializeTenant(odeme.tenant),
    muvekkil: serializeMuvekkil(odeme.muvekkil),
    dosya: serializeDosya(odeme.dosya),
    mahkemeIcra: odeme.dosya.mahkeme?.trim() || odeme.dosya.icraDairesi?.trim() || null,
    dosyaNo: odeme.dosya.dosyaNo,
    taksitNo: odeme.taksit.taksitNo,
    taksitTutari: decimalStr(odeme.taksit.tutar),
    taksitOdenenToplam: taksitOdenen,
    taksitKalanTutar: taksitKalan,
    taksitDurum,
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
