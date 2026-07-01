import type { Tenant } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'

export type ResolveTenantForRenewalInput = {
  /** Woontegra Website müşteri kimliği — zorunlu. */
  externalCustomerId: string
  tenantId?: string | null
  licenseKey?: string | null
}

const RENEWAL_IDENTITY_MSG =
  'Üyelik yenileme için tenantId + lisans anahtarı veya müşteri ID + lisans anahtarı gereklidir.'

const CUSTOMER_MISMATCH_MSG = 'Bu üyelik bu müşteri hesabına bağlı görünmüyor.'

function assertLicenseKeyMatches(tenant: Tenant, licenseKey: string): void {
  const stored = tenant.lisansAnahtari?.trim()
  if (!stored || stored !== licenseKey) {
    throw new AppError(409, 'Lisans anahtarı bu büro ile eşleşmiyor.', 'LICENSE_KEY_MISMATCH')
  }
}

/** tenant.externalCustomerId doluysa istekteki müşteri kimliği ile birebir eşleşmeli. */
function assertExternalCustomerMatches(tenant: Tenant, externalCustomerId: string): void {
  const stored = tenant.externalCustomerId?.trim()
  if (!stored) return
  if (stored !== externalCustomerId) {
    throw new AppError(403, CUSTOMER_MISMATCH_MSG, 'CUSTOMER_MEMBERSHIP_MISMATCH')
  }
}

/**
 * Güvenli yenileme eşleştirmesi — e-posta / telefon / isim kullanılmaz.
 * Öncelik: (tenantId + licenseKey) → (externalCustomerId + licenseKey) → (licenseKey fallback).
 */
export async function resolveTenantForRenewal(input: ResolveTenantForRenewalInput): Promise<Tenant> {
  const externalCustomerId = input.externalCustomerId?.trim()
  if (!externalCustomerId) {
    throw new AppError(422, RENEWAL_IDENTITY_MSG, 'RENEWAL_IDENTITY_REQUIRED')
  }

  const licenseKey = input.licenseKey?.trim()
  if (!licenseKey) {
    throw new AppError(422, RENEWAL_IDENTITY_MSG, 'RENEWAL_IDENTITY_REQUIRED')
  }

  const tenantId = input.tenantId?.trim()

  // A) tenantId + licenseKey
  if (tenantId) {
    const t = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!t) throw new AppError(404, 'Büro bulunamadı.', 'NOT_FOUND')
    assertLicenseKeyMatches(t, licenseKey)
    assertExternalCustomerMatches(t, externalCustomerId)
    return t
  }

  // B) externalCustomerId + licenseKey
  const byCustomer = await prisma.tenant.findMany({
    where: {
      externalCustomerId,
      lisansAnahtari: licenseKey
    }
  })
  if (byCustomer.length === 1) {
    return byCustomer[0]!
  }
  if (byCustomer.length > 1) {
    throw new AppError(
      409,
      'Birden fazla büro bulundu; tenantId ile yenileme yapın.',
      'AMBIGUOUS_TENANT'
    )
  }

  // C) licenseKey tek başına (son fallback)
  const byKey = await prisma.tenant.findUnique({ where: { lisansAnahtari: licenseKey } })
  if (!byKey) {
    throw new AppError(404, 'Lisans anahtarı ile büro bulunamadı.', 'NOT_FOUND')
  }
  assertExternalCustomerMatches(byKey, externalCustomerId)
  return byKey
}
