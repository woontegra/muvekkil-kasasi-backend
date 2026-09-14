import { createHash } from 'node:crypto'
import {
  BildirimEntityType,
  BildirimIsDurumu,
  MakbuzDurumu,
  OfisKasaIslemTipi,
  VekaletUcretiDurum,
  type ParaBirimi,
  type Prisma,
  type User
} from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { prisma } from '../lib/prisma.js'
import { filterAktifTahsilatOdemeleri, isTahsilatOdemeAktif } from '../lib/tahsilatOdemeAktif.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  softDeleteOfisHareketAndDuzeltmeler,
  verifyBuroSahibiPassword,
  type GuvenliOfisHareketSilBody
} from '../ofisKasa/ofisGiderGuvenliSil.service.js'
import { countPendingBildirimJobs } from '../tahsilatBildirim/eligibility.service.js'
import { setTaksitOtomatikBildirimAktif } from '../tahsilatBildirim/taksitBildirimColumn.js'
import { assertDosyaForVekalet, serializeVekaletUcreti } from './vekalet.service.js'

export const VEKALET_SIL_ESMM_BLOCK_MESSAGE =
  'Bu vekalet planında e-SMM (SMM no) kaydı bulunan taksitler var. Vekalet ücretini güvenli iptal etmeden önce ilgili e-SMM kayıtlarını usulüne uygun iptal etmelisiniz.'

const BILDIRIM_IPTAL_VEKALET = 'Vekalet ücreti güvenli iptal'

export type VekaletSilEtkiAnaliziDto = {
  vekaletUcretiId: string
  toplamTutar: string
  paraBirimi: ParaBirimi
  aktifTaksitSayisi: number
  odenmisKismiTaksitSayisi: number
  aktifTahsilatSayisi: number
  mahsupByCurrency: Record<string, string>
  kasaGirisByCurrency: Record<string, string>
  makbuzSayisi: number
  smmFlags: {
    taksitWithSmmNo: number
    odemeSmmKesilmedi: number
  }
  planliBildirimSayisi: number
  fingerprint: string
  afterState: string[]
}

export type GuvenliVekaletUcretiSilBody = GuvenliOfisHareketSilBody & {
  analysisFingerprint: string
}

export type GuvenliVekaletUcretiSilResult = {
  alreadyDone: boolean
  vekaletUcretiId: string
  auditMessage: string
}

type OdemeForFingerprint = {
  id: string
  tutar: Prisma.Decimal
  kasaTutari: Prisma.Decimal
  iptalAt: Date | null
  ofisKasaHareketId: string | null
  ofisKasaHareket: { deletedAt: Date | null } | null
}

function decimalStr(d: Prisma.Decimal | number): string {
  return typeof d === 'number' ? d.toFixed(2) : d.toFixed(2)
}

function addMoney(map: Record<string, number>, currency: string, amount: number): void {
  map[currency] = (map[currency] ?? 0) + amount
}

function moneyMapToApi(map: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    out[k] = v.toFixed(2)
  }
  return out
}

export function computeVekaletSilFingerprint(input: {
  vekaletUpdatedAt: Date
  aktifOdemeler: ReadonlyArray<Pick<OdemeForFingerprint, 'id' | 'tutar' | 'kasaTutari'>>
}): string {
  const parts = input.aktifOdemeler
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((o) => `${o.id}|${decimalStr(o.tutar)}|${decimalStr(o.kasaTutari)}`)
  const payload = `${input.vekaletUpdatedAt.toISOString()}\n${parts.join('\n')}`
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

export function assertVekaletSilFingerprintMatch(
  expected: string,
  actual: string
): void {
  if (expected !== actual) {
    throw new AppError(
      409,
      'Etki analizi güncel değil; lütfen önizlemeyi yenileyip tekrar deneyin.',
      'STALE_ANALYSIS'
    )
  }
}

function assertNoEsmmBlock(taksitler: ReadonlyArray<{ smmNo: string | null }>): void {
  const blocked = taksitler.some((t) => (t.smmNo?.trim() ?? '').length > 0)
  if (blocked) {
    throw new AppError(409, VEKALET_SIL_ESMM_BLOCK_MESSAGE, 'VEKALET_ESMM_BLOCK')
  }
}

type LoadedVekaletBundle = NonNullable<Awaited<ReturnType<typeof loadAktifVekaletBundle>>>
type LoadedAktifVekalet = NonNullable<LoadedVekaletBundle['vekalet']>

async function loadAktifVekaletBundle(tenantId: string, dosyaId: string) {
  const dosya = await assertDosyaForVekalet(tenantId, dosyaId)
  if (!dosya) return null

  const vekalet = await prisma.vekaletUcreti.findFirst({
    where: { tenantId, dosyaId, durum: VekaletUcretiDurum.AKTIF },
    include: {
      taksitler: {
        orderBy: [{ taksitNo: 'asc' }],
        include: {
          odemeler: {
            orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }],
            include: { ofisKasaHareket: { select: { deletedAt: true } } }
          }
        }
      }
    }
  })
  return { dosya, vekalet }
}

function buildAnalysisFromVekalet(vekalet: LoadedAktifVekalet): VekaletSilEtkiAnaliziDto {
  const aktifTaksitler = vekalet.taksitler.filter((t) => t.odemeDurumu !== 'IPTAL')
  const mahsup: Record<string, number> = {}
  const kasaGiris: Record<string, number> = {}
  let aktifTahsilatSayisi = 0
  let makbuzSayisi = 0
  let odemeSmmKesilmedi = 0
  let odenmisKismiTaksitSayisi = 0

  const allAktifOdemeler: OdemeForFingerprint[] = []

  for (const t of aktifTaksitler) {
    const aktifOd = filterAktifTahsilatOdemeleri(t.odemeler)
    if (aktifOd.some((o) => Number(o.tutar) > 0)) {
      odenmisKismiTaksitSayisi += 1
    }
    for (const o of aktifOd) {
      allAktifOdemeler.push(o)
      aktifTahsilatSayisi += 1
      if (o.makbuzNo?.trim()) makbuzSayisi += 1
      if (!o.smmKesildiMi && Number(o.tutar) > 0) odemeSmmKesilmedi += 1
      addMoney(mahsup, o.alacakParaBirimi, Number(o.tutar))
      addMoney(kasaGiris, o.odemeParaBirimi, Number(o.kasaTutari))
    }
  }

  const taksitWithSmmNo = vekalet.taksitler.filter((t) => (t.smmNo?.trim() ?? '').length > 0).length

  const fingerprint = computeVekaletSilFingerprint({
    vekaletUpdatedAt: vekalet.updatedAt,
    aktifOdemeler: allAktifOdemeler
  })

  const afterState = [
    'Vekalet ücreti durumu IPTAL olur; yeni anlaşılan ücret aynı dosyada tanımlanabilir.',
    'Taksitler IPTAL damgası alır; tahsilat satırları ve makbuz numaraları korunur, makbuzlar iptal işaretlenir.',
    'Bağlı ofis kasası gelirleri ve dosya kasa hareketleri mali toplamlardan çıkarılır (soft-delete / iptal).',
    'Planlanmış hatırlatma işleri iptal edilir.'
  ]

  return {
    vekaletUcretiId: vekalet.id,
    toplamTutar: decimalStr(vekalet.toplamTutar),
    paraBirimi: vekalet.paraBirimi,
    aktifTaksitSayisi: aktifTaksitler.length,
    odenmisKismiTaksitSayisi,
    aktifTahsilatSayisi,
    mahsupByCurrency: moneyMapToApi(mahsup),
    kasaGirisByCurrency: moneyMapToApi(kasaGiris),
    makbuzSayisi,
    smmFlags: { taksitWithSmmNo, odemeSmmKesilmedi },
    planliBildirimSayisi: 0,
    fingerprint,
    afterState
  }
}

export async function buildVekaletSilEtkiAnalizi(
  tenantId: string,
  dosyaId: string
): Promise<VekaletSilEtkiAnaliziDto | null> {
  const bundle = await loadAktifVekaletBundle(tenantId, dosyaId)
  if (!bundle) return null
  if (!bundle.vekalet) {
    throw new AppError(404, 'Aktif vekalet ücreti bulunamadı.', 'NOT_FOUND')
  }

  assertNoEsmmBlock(bundle.vekalet.taksitler)

  const taksitIds = bundle.vekalet.taksitler.map((t) => t.id)
  let planli = 0
  for (const tid of taksitIds) {
    planli += await countPendingBildirimJobs({ tenantId, taksitId: tid })
  }

  const dto = buildAnalysisFromVekalet(bundle.vekalet)
  dto.planliBildirimSayisi = planli
  return dto
}

export async function guvenliVekaletUcretiSil(
  tenantId: string,
  actor: Pick<User, 'id' | 'role' | 'adSoyad' | 'sifreHash'>,
  dosyaId: string,
  body: GuvenliVekaletUcretiSilBody,
  req: Request
): Promise<GuvenliVekaletUcretiSilResult> {
  const bundle = await loadAktifVekaletBundle(tenantId, dosyaId)
  if (!bundle) {
    throw new AppError(404, 'Dosya bulunamadı.', 'NOT_FOUND')
  }

  const iptalVekalet = bundle.vekalet
  if (!iptalVekalet) {
    const cancelled = await prisma.vekaletUcreti.findFirst({
      where: { tenantId, dosyaId, durum: VekaletUcretiDurum.IPTAL },
      orderBy: { deletedAt: 'desc' },
      select: { id: true }
    })
    if (cancelled) {
      return {
        alreadyDone: true,
        vekaletUcretiId: cancelled.id,
        auditMessage: 'Vekalet ücreti zaten iptal edilmişti.'
      }
    }
    throw new AppError(404, 'Aktif vekalet ücreti bulunamadı.', 'NOT_FOUND')
  }

  const { reason, meta } = await verifyBuroSahibiPassword(
    tenantId,
    actor,
    iptalVekalet.id,
    body,
    req,
    'VEKALET_UCRETI_GUVENLI_IPTAL'
  )

  assertNoEsmmBlock(iptalVekalet.taksitler)

  const aktifOdemelerFlat = iptalVekalet.taksitler.flatMap((t) =>
    filterAktifTahsilatOdemeleri(t.odemeler)
  )
  const fingerprint = computeVekaletSilFingerprint({
    vekaletUpdatedAt: iptalVekalet.updatedAt,
    aktifOdemeler: aktifOdemelerFlat
  })
  assertVekaletSilFingerprintMatch(body.analysisFingerprint?.trim() ?? '', fingerprint)

  const now = new Date()
  const actorName = actor.adSoyad.trim() || 'Büro sahibi'
  const snapshotOld = {
    vekalet: serializeVekaletUcreti(iptalVekalet),
    taksitler: iptalVekalet.taksitler.map((t) => ({
      id: t.id,
      taksitNo: t.taksitNo,
      odemeDurumu: t.odemeDurumu,
      odemeler: t.odemeler.map((o) => ({
        id: o.id,
        tutar: decimalStr(o.tutar),
        kasaTutari: decimalStr(o.kasaTutari),
        makbuzNo: o.makbuzNo,
        iptalAt: o.iptalAt?.toISOString() ?? null,
        ofisKasaHareketId: o.ofisKasaHareketId,
        kasaHareketId: o.kasaHareketId
      }))
    }))
  }

  const taksitIds = iptalVekalet.taksitler.map((t) => t.id)

  const txResult = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT id FROM "vekalet_ucreti"
      WHERE id = ${iptalVekalet.id} AND tenant_id = ${tenantId}
      FOR UPDATE
    `

    const fresh = await tx.vekaletUcreti.findFirst({
      where: { id: iptalVekalet.id, tenantId },
      include: {
        taksitler: {
          include: {
            odemeler: {
              include: { ofisKasaHareket: { select: { deletedAt: true } } }
            }
          }
        }
      }
    })
    if (!fresh) throw new AppError(404, 'Vekalet bulunamadı.', 'NOT_FOUND')
    if (fresh.durum === VekaletUcretiDurum.IPTAL) {
      return { alreadyDone: true as const, softDeletedOfisIds: [] as string[] }
    }

    const freshFp = computeVekaletSilFingerprint({
      vekaletUpdatedAt: fresh.updatedAt,
      aktifOdemeler: fresh.taksitler.flatMap((t) => filterAktifTahsilatOdemeleri(t.odemeler))
    })
    assertVekaletSilFingerprintMatch(body.analysisFingerprint.trim(), freshFp)

    const softDeletedOfisIds: string[] = []

    for (const t of fresh.taksitler) {
      for (const o of t.odemeler) {
        if (!isTahsilatOdemeAktif(o)) continue

        if (o.ofisKasaHareketId) {
          const ids = await softDeleteOfisHareketAndDuzeltmeler(tx, {
            tenantId,
            hareketId: o.ofisKasaHareketId,
            actorId: actor.id,
            reason,
            now,
            expectedTip: OfisKasaIslemTipi.GELIR,
            releaseKaynakSlot: true,
            originalKaynakId: o.id
          })
          softDeletedOfisIds.push(...ids)
        }

        if (o.kasaHareketId) {
          await tx.kasaHareketi.updateMany({
            where: { id: o.kasaHareketId, tenantId, deletedAt: null },
            data: {
              deletedAt: now,
              deletedById: actor.id,
              deleteReason: reason
            }
          })
        }

        await tx.vekaletTaksitOdeme.updateMany({
          where: { id: o.id, tenantId, iptalAt: null },
          data: {
            iptalAt: now,
            iptalById: actor.id,
            iptalNedeni: reason,
            makbuzDurumu: MakbuzDurumu.IPTAL
          }
        })
      }
    }

    await tx.vekaletTaksiti.updateMany({
      where: { tenantId, vekaletUcretiId: fresh.id },
      data: { odemeDurumu: 'IPTAL', updatedById: actor.id }
    })

    await tx.vekaletUcreti.update({
      where: { id: fresh.id },
      data: {
        durum: VekaletUcretiDurum.IPTAL,
        deletedAt: now,
        deletedById: actor.id,
        deleteReason: reason,
        updatedById: actor.id
      }
    })

    await tx.tahsilatBildirimIsi.updateMany({
      where: {
        tenantId,
        taksitId: { in: taksitIds },
        durum: { in: [BildirimIsDurumu.PLANLANDI, BildirimIsDurumu.KUYRUKTA] }
      },
      data: {
        durum: BildirimIsDurumu.IPTAL_EDILDI,
        iptalNedeni: BILDIRIM_IPTAL_VEKALET,
        lockedAt: null,
        lockedBy: null
      }
    })

    await tx.bildirimPlanEntity.deleteMany({
      where: {
        tenantId,
        entityType: BildirimEntityType.VEKALET_TAKSITI,
        entityId: { in: taksitIds }
      }
    })

    return { alreadyDone: false as const, softDeletedOfisIds }
  })

  if (txResult.alreadyDone) {
    return {
      alreadyDone: true,
      vekaletUcretiId: iptalVekalet.id,
      auditMessage: 'Vekalet ücreti zaten iptal edilmişti.'
    }
  }

  for (const tid of taksitIds) {
    await setTaksitOtomatikBildirimAktif(tid, false).catch(() => {})
  }

  const auditMessage = `${actorName}, ${now.toLocaleString('tr-TR')} tarihinde vekalet ücretini güvenli iptal etti. Neden: ${reason}`

  await writeAuditLog({
    tenantId,
    userId: actor.id,
    action: 'VEKALET_UCRETI_GUVENLI_IPTAL',
    entityType: 'VekaletUcreti',
    entityId: iptalVekalet.id,
    oldValue: snapshotOld,
    newValue: {
      durum: VekaletUcretiDurum.IPTAL,
      deletedAt: now.toISOString(),
      deletedById: actor.id,
      deleteReason: reason,
      softDeletedOfisIds: txResult.softDeletedOfisIds,
      message: auditMessage
    },
    meta: { dosyaId, fingerprint, message: auditMessage },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return {
    alreadyDone: false,
    vekaletUcretiId: iptalVekalet.id,
    auditMessage
  }
}
