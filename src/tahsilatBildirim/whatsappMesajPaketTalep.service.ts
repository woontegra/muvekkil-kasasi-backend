/**
 * WhatsApp ek mesaj paketi satın alma talepleri.
 * Online ödeme yok — Platform Admin dışarıdan ödeme kontrol edip onaylar.
 */
import { Prisma, WhatsAppMesajKrediHareketTipi, WhatsAppMesajPaketTalepDurum } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { getWhatsAppMesajPaketiById, requireActiveWhatsAppMesajPaketi } from './whatsappMesajPaketleri.js'
import { addCreditInTx, ensureWhatsAppMesajKredisi } from './whatsappMesajKredi.service.js'
import { generateWhatsAppPaketTalepPaymentReference } from './whatsappMesajPaketTalepPaymentRef.js'
import { scheduleAdminWhatsAppPaketTalepCreatedNotifications } from './whatsappMesajPaketTalepNotify.js'

export type WhatsAppMesajPaketTalepDto = {
  id: string
  tenantId: string
  packageId: string
  mesajAdedi: number
  fiyatTL: number
  paymentReference: string
  durum: WhatsAppMesajPaketTalepDurum
  adminNotu: string | null
  createdAt: string
  updatedAt: string
  approvedAt: string | null
  approvedByAdminId: string | null
}

function toDto(row: {
  id: string
  tenantId: string
  packageId: string
  mesajAdedi: number
  fiyatTL: number
  paymentReference: string
  durum: WhatsAppMesajPaketTalepDurum
  adminNotu: string | null
  createdAt: Date
  updatedAt: Date
  approvedAt: Date | null
  approvedByAdminId: string | null
}): WhatsAppMesajPaketTalepDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    packageId: row.packageId,
    mesajAdedi: row.mesajAdedi,
    fiyatTL: row.fiyatTL,
    paymentReference: row.paymentReference,
    durum: row.durum,
    adminNotu: row.adminNotu,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedByAdminId: row.approvedByAdminId
  }
}

async function createTalepWithUniquePaymentRef(data: {
  tenantId: string
  packageId: string
  mesajAdedi: number
  fiyatTL: number
  createdByUserId: string
}) {
  const maxAttempts = 12
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const paymentReference = generateWhatsAppPaketTalepPaymentReference()
    try {
      return await prisma.whatsAppMesajPaketTalebi.create({
        data: {
          id: randomUUID(),
          tenantId: data.tenantId,
          packageId: data.packageId,
          mesajAdedi: data.mesajAdedi,
          fiyatTL: data.fiyatTL,
          paymentReference,
          durum: WhatsAppMesajPaketTalepDurum.BEKLIYOR,
          createdByUserId: data.createdByUserId
        }
      })
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        Array.isArray(err.meta?.target) &&
        (err.meta.target as string[]).includes('payment_reference')
      ) {
        continue
      }
      throw err
    }
  }
  throw new AppError(
    500,
    'Ödeme referansı üretilemedi. Lütfen tekrar deneyin.',
    'WA_PAKET_TALEP_PAYMENT_REF_FAILED'
  )
}

export async function listTenantWhatsAppMesajPaketTalepleri(
  tenantId: string,
  opts?: { durum?: WhatsAppMesajPaketTalepDurum; limit?: number }
): Promise<WhatsAppMesajPaketTalepDto[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100)
  const rows = await prisma.whatsAppMesajPaketTalebi.findMany({
    where: {
      tenantId,
      ...(opts?.durum ? { durum: opts.durum } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: limit
  })
  return rows.map(toDto)
}

export async function listBekleyenPackageIds(tenantId: string): Promise<string[]> {
  const rows = await prisma.whatsAppMesajPaketTalebi.findMany({
    where: { tenantId, durum: WhatsAppMesajPaketTalepDurum.BEKLIYOR },
    select: { packageId: true }
  })
  return rows.map((r) => r.packageId)
}

/**
 * Tenant satın alma talebi oluşturur.
 * packageId client'tan; mesajAdedi/fiyatTL yalnız katalogdan.
 * Aynı paket için BEKLIYOR varsa yeni oluşturmaz — mevcut talebi döner.
 */
export async function createWhatsAppMesajPaketTalebi(input: {
  tenantId: string
  userId: string
  packageId: string
}): Promise<{ talep: WhatsAppMesajPaketTalepDto; alreadyExists: boolean }> {
  const paket = requireActiveWhatsAppMesajPaketi(input.packageId)

  const existing = await prisma.whatsAppMesajPaketTalebi.findFirst({
    where: {
      tenantId: input.tenantId,
      packageId: paket.id,
      durum: WhatsAppMesajPaketTalepDurum.BEKLIYOR
    }
  })
  if (existing) {
    return { talep: toDto(existing), alreadyExists: true }
  }

  try {
    const row = await createTalepWithUniquePaymentRef({
      tenantId: input.tenantId,
      packageId: paket.id,
      mesajAdedi: paket.mesajAdedi,
      fiyatTL: paket.fiyatTL,
      createdByUserId: input.userId
    })
    const talep = toDto(row)
    // Yeni kayıt — admin e-posta + WhatsApp; bildirim hatası talebi bozmaz.
    scheduleAdminWhatsAppPaketTalepCreatedNotifications(talep)
    return { talep, alreadyExists: false }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const again = await prisma.whatsAppMesajPaketTalebi.findFirst({
        where: {
          tenantId: input.tenantId,
          packageId: paket.id,
          durum: WhatsAppMesajPaketTalepDurum.BEKLIYOR
        }
      })
      if (again) return { talep: toDto(again), alreadyExists: true }
    }
    throw err
  }
}

export async function adminListWhatsAppMesajPaketTalepleri(opts?: {
  durum?: WhatsAppMesajPaketTalepDurum
  tenantId?: string
  limit?: number
  offset?: number
}) {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100)
  const offset = Math.max(opts?.offset ?? 0, 0)
  const where: Prisma.WhatsAppMesajPaketTalebiWhereInput = {
    ...(opts?.durum ? { durum: opts.durum } : {}),
    ...(opts?.tenantId ? { tenantId: opts.tenantId } : {})
  }
  const [items, total] = await Promise.all([
    prisma.whatsAppMesajPaketTalebi.findMany({
      where,
      orderBy: [{ durum: 'asc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
      include: {
        tenant: { select: { id: true, buroAdi: true, musteriNo: true } }
      }
    }),
    prisma.whatsAppMesajPaketTalebi.count({ where })
  ])

  return {
    total,
    items: items.map((row) => ({
      ...toDto(row),
      buroAdi: row.tenant.buroAdi,
      musteriNo: row.tenant.musteriNo
    }))
  }
}

/**
 * Admin onay: addCredit(PAKET_SATIN_ALMA, paymentId=talep.id) — idempotent.
 * Kredi + talep durumu TEK transaction; kredi yazılıp talep BEKLIYOR kalamaz.
 */
export async function adminOnaylaWhatsAppMesajPaketTalebi(input: {
  talepId: string
  adminId: string
  adminNotu?: string | null
}): Promise<{
  talep: WhatsAppMesajPaketTalepDto
  credit: { oncekiBakiye: number; sonrakiBakiye: number; alreadyApplied: boolean }
}> {
  const existing = await prisma.whatsAppMesajPaketTalebi.findUnique({
    where: { id: input.talepId }
  })
  if (!existing) {
    throw new AppError(404, 'Satın alma talebi bulunamadı.', 'WA_PAKET_TALEP_NOT_FOUND')
  }

  if (existing.durum === WhatsAppMesajPaketTalepDurum.ONAYLANDI) {
    const bal = await prisma.whatsAppMesajKredisi.findUnique({
      where: { tenantId: existing.tenantId },
      select: { bakiye: true }
    })
    const b = bal?.bakiye ?? 0
    return {
      talep: toDto(existing),
      credit: { oncekiBakiye: b, sonrakiBakiye: b, alreadyApplied: true }
    }
  }

  if (existing.durum !== WhatsAppMesajPaketTalepDurum.BEKLIYOR) {
    throw new AppError(
      409,
      'Yalnız bekleyen talepler onaylanabilir.',
      'WA_PAKET_TALEP_NOT_PENDING'
    )
  }

  await ensureWhatsAppMesajKredisi(existing.tenantId)

  const katalog = getWhatsAppMesajPaketiById(existing.packageId)
  const miktar = katalog?.aktif ? katalog.mesajAdedi : existing.mesajAdedi
  const aciklama =
    input.adminNotu?.trim() ||
    `WhatsApp mesaj paketi talebi onaylandı (${miktar} mesaj, ${existing.fiyatTL} TL)`

  try {
    const out = await prisma.$transaction(async (tx) => {
      const talep = await tx.whatsAppMesajPaketTalebi.findUnique({
        where: { id: input.talepId }
      })
      if (!talep) {
        throw new AppError(404, 'Satın alma talebi bulunamadı.', 'WA_PAKET_TALEP_NOT_FOUND')
      }
      if (talep.durum === WhatsAppMesajPaketTalepDurum.ONAYLANDI) {
        const bal = await tx.whatsAppMesajKredisi.findUnique({
          where: { tenantId: talep.tenantId },
          select: { bakiye: true }
        })
        const b = bal?.bakiye ?? 0
        return {
          talep: toDto(talep),
          credit: { oncekiBakiye: b, sonrakiBakiye: b, alreadyApplied: true }
        }
      }
      if (talep.durum !== WhatsAppMesajPaketTalepDurum.BEKLIYOR) {
        throw new AppError(
          409,
          'Yalnız bekleyen talepler onaylanabilir.',
          'WA_PAKET_TALEP_NOT_PENDING'
        )
      }

      const credit = await addCreditInTx(tx, {
        tenantId: talep.tenantId,
        amount: miktar,
        tip: WhatsAppMesajKrediHareketTipi.PAKET_SATIN_ALMA,
        paymentId: talep.id,
        aciklama
      })

      const updated = await tx.whatsAppMesajPaketTalebi.update({
        where: { id: talep.id },
        data: {
          durum: WhatsAppMesajPaketTalepDurum.ONAYLANDI,
          adminNotu: input.adminNotu?.trim() || talep.adminNotu,
          approvedByAdminId: input.adminId,
          approvedAt: new Date()
        }
      })

      return {
        talep: toDto(updated),
        credit: {
          oncekiBakiye: credit.oncekiBakiye,
          sonrakiBakiye: credit.sonrakiBakiye,
          alreadyApplied: Boolean(credit.alreadyApplied)
        }
      }
    })
    return out
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Yarış: kredi yazıldıysa talebi yine ONAYLANDI yap (heal).
      const healed = await prisma.$transaction(async (tx) => {
        const talep = await tx.whatsAppMesajPaketTalebi.findUnique({
          where: { id: input.talepId }
        })
        if (!talep) {
          throw new AppError(404, 'Satın alma talebi bulunamadı.', 'WA_PAKET_TALEP_NOT_FOUND')
        }
        const bal = await tx.whatsAppMesajKredisi.findUnique({
          where: { tenantId: talep.tenantId },
          select: { bakiye: true }
        })
        const b = bal?.bakiye ?? 0
        if (talep.durum === WhatsAppMesajPaketTalepDurum.ONAYLANDI) {
          return {
            talep: toDto(talep),
            credit: { oncekiBakiye: b, sonrakiBakiye: b, alreadyApplied: true }
          }
        }
        if (talep.durum !== WhatsAppMesajPaketTalepDurum.BEKLIYOR) {
          throw new AppError(
            409,
            'Yalnız bekleyen talepler onaylanabilir.',
            'WA_PAKET_TALEP_NOT_PENDING'
          )
        }
        const updated = await tx.whatsAppMesajPaketTalebi.update({
          where: { id: talep.id },
          data: {
            durum: WhatsAppMesajPaketTalepDurum.ONAYLANDI,
            adminNotu: input.adminNotu?.trim() || talep.adminNotu,
            approvedByAdminId: input.adminId,
            approvedAt: new Date()
          }
        })
        return {
          talep: toDto(updated),
          credit: { oncekiBakiye: b, sonrakiBakiye: b, alreadyApplied: true }
        }
      })
      return healed
    }
    throw err
  }
}

export async function adminReddetWhatsAppMesajPaketTalebi(input: {
  talepId: string
  adminId: string
  adminNotu?: string | null
}): Promise<WhatsAppMesajPaketTalepDto> {
  const talep = await prisma.whatsAppMesajPaketTalebi.findUnique({
    where: { id: input.talepId }
  })
  if (!talep) {
    throw new AppError(404, 'Satın alma talebi bulunamadı.', 'WA_PAKET_TALEP_NOT_FOUND')
  }
  if (talep.durum === WhatsAppMesajPaketTalepDurum.ONAYLANDI) {
    throw new AppError(409, 'Onaylanmış talep reddedilemez.', 'WA_PAKET_TALEP_ALREADY_APPROVED')
  }
  if (talep.durum !== WhatsAppMesajPaketTalepDurum.BEKLIYOR) {
    throw new AppError(409, 'Yalnız bekleyen talepler reddedilebilir.', 'WA_PAKET_TALEP_NOT_PENDING')
  }

  const updated = await prisma.whatsAppMesajPaketTalebi.update({
    where: { id: talep.id },
    data: {
      durum: WhatsAppMesajPaketTalepDurum.REDDEDILDI,
      adminNotu: input.adminNotu?.trim() || null,
      approvedByAdminId: input.adminId,
      approvedAt: new Date()
    }
  })
  return toDto(updated)
}
