import { Prisma, type Tenant, type TenantLicenseRenewal } from '@prisma/client'
import type { LicenseRenewalSource } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'

export function dayStart(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Uzatma tabanı: bitiş takvim günü bugün veya sonrasıysa mevcut bitişten; aksi halde bugünün başı. */
export function computeExtensionBaseDate(tenant: Pick<Tenant, 'lisansBitisTarihi'>): Date {
  const today = dayStart(new Date())
  const end = tenant.lisansBitisTarihi
  if (!end) return today
  const endDay = dayStart(end)
  if (endDay.getTime() >= today.getTime()) return new Date(end)
  return today
}

export function addDaysFromBase(base: Date, days: number): Date {
  const next = new Date(base)
  next.setDate(next.getDate() + days)
  return next
}

export function addFromBase(base: Date, miktar: number, birim: 'GUN' | 'AY' | 'YIL'): Date {
  const next = new Date(base)
  if (birim === 'GUN') next.setDate(next.getDate() + miktar)
  else if (birim === 'AY') next.setMonth(next.getMonth() + miktar)
  else next.setFullYear(next.getFullYear() + miktar)
  return next
}

function calcAddedDays(base: Date, newEnd: Date): number {
  const ms = newEnd.getTime() - base.getTime()
  return Math.max(1, Math.ceil(ms / 86_400_000))
}

export type ExtendTenantLicenseInput = {
  tenantId: string
  source: LicenseRenewalSource
  /** Gün ekle (Website renew). */
  renewalDays?: number
  /** Doğrudan bitiş tarihi (admin özel tarih). */
  newEndDate?: Date
  /** Miktar + birim ile uzatma (admin). */
  addDuration?: { miktar: number; birim: 'GUN' | 'AY' | 'YIL' }
  demoMu?: boolean
  externalOrderId?: string | null
  externalCustomerId?: string | null
  licenseKey?: string | null
  amount?: number | null
  currency?: string | null
  paidAt?: Date | null
  note?: string | null
  appendLicenseNote?: string | null
}

export type ExtendTenantLicenseResult = {
  tenant: Tenant
  renewal: TenantLicenseRenewal
  previousEndDate: Date
  newEndDate: Date
  renewalDays: number
}

export async function extendTenantLicense(input: ExtendTenantLicenseInput): Promise<ExtendTenantLicenseResult> {
  const t = await prisma.tenant.findUnique({ where: { id: input.tenantId } })
  if (!t) throw new AppError(404, 'Büro bulunamadı.', 'NOT_FOUND')

  const previousEndDate = t.lisansBitisTarihi ? new Date(t.lisansBitisTarihi) : dayStart(new Date())
  const base = computeExtensionBaseDate(t)

  let newEndDate: Date
  let renewalDays: number

  if (input.newEndDate != null) {
    newEndDate = new Date(input.newEndDate)
    const bisDay = dayStart(newEndDate)
    const today = dayStart(new Date())
    if (bisDay.getTime() < today.getTime()) {
      throw new AppError(400, 'Bitiş tarihi bugünden önce olamaz.', 'VALIDATION')
    }
    renewalDays = calcAddedDays(base, newEndDate)
  } else if (input.renewalDays != null) {
    if (input.renewalDays < 1) {
      throw new AppError(400, 'renewalDays en az 1 olmalı.', 'VALIDATION')
    }
    newEndDate = addDaysFromBase(base, input.renewalDays)
    renewalDays = input.renewalDays
  } else if (input.addDuration != null) {
    newEndDate = addFromBase(base, input.addDuration.miktar, input.addDuration.birim)
    renewalDays = calcAddedDays(base, newEndDate)
  } else {
    throw new AppError(400, 'Uzatma süresi belirtilmedi.', 'VALIDATION')
  }

  const isDemo = input.demoMu === true
  const paidAt = input.paidAt ?? new Date()
  const currency = input.currency?.trim() || 'TRY'

  const updated = await prisma.$transaction(async (tx) => {
    const renewal = await tx.tenantLicenseRenewal.create({
      data: {
        tenantId: t.id,
        externalOrderId: input.externalOrderId?.trim() || null,
        externalCustomerId: input.externalCustomerId?.trim() || null,
        licenseKey: input.licenseKey?.trim() || t.lisansAnahtari,
        previousEndDate,
        newEndDate,
        renewalDays,
        amount: input.amount != null ? new Prisma.Decimal(input.amount) : null,
        currency,
        paidAt,
        source: input.source,
        note: input.note?.trim() || null
      }
    })

    const tenant = await tx.tenant.update({
      where: { id: t.id },
      data: {
        ...(t.lisansBaslangicTarihi == null ? { lisansBaslangicTarihi: new Date() } : {}),
        lisansBitisTarihi: newEndDate,
        lisansDurumu: isDemo ? 'DEMO' : 'AKTIF',
        demoMu: isDemo,
        demoBitisTarihi: isDemo ? newEndDate : null,
        sonOdemeTarihi: paidAt,
        ...(input.amount != null ? { yillikUcret: new Prisma.Decimal(input.amount) } : {}),
        aktifMi: true,
        ...(input.appendLicenseNote
          ? {
              lisansNotlari: [t.lisansNotlari, input.appendLicenseNote].filter(Boolean).join('\n')
            }
          : {})
      }
    })

    return { tenant, renewal }
  })

  return {
    tenant: updated.tenant,
    renewal: updated.renewal,
    previousEndDate,
    newEndDate,
    renewalDays
  }
}
