import type { Tenant, TenantLicenseStatus } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'

export type TenantLicenseContext = {
  tenant: Tenant
  writeAllowed: boolean
}

export const LICENSE_WRITE_DENIED_MESSAGE =
  'Lisans süreniz sona ermiştir. İşlem yapabilmek için lisansınızı yenilemeniz gerekir.'

function startOfTodayLocal(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function demoExpired(tenant: Tenant): boolean {
  if (!tenant.demoMu || !tenant.demoBitisTarihi) return false
  return tenant.demoBitisTarihi < new Date()
}

/** Demo ise demo bitişi, aksi halde lisans bitişi. */
export function effectiveLicenseEnd(tenant: Tenant): Date | null {
  if (tenant.lisansDurumu === 'DEMO' && tenant.demoMu && tenant.demoBitisTarihi) {
    return tenant.demoBitisTarihi
  }
  return tenant.lisansBitisTarihi
}

/** Bitiş takvim günü bugünden önce mi (bugün dahil geçerli). */
export function isLicenseEndDatePassed(tenant: Tenant): boolean {
  const end = effectiveLicenseEnd(tenant)
  if (!end) return false
  const today = startOfTodayLocal()
  const endDay = new Date(end)
  endDay.setHours(0, 0, 0, 0)
  return endDay.getTime() < today.getTime()
}

/**
 * Yazma işlemleri engellenmeli mi (read-only).
 * SURESI_DOLDU veya AKTIF + geçmiş lisansBitisTarihi.
 */
export function isTenantLicenseWriteBlocked(tenant: Tenant): boolean {
  if (tenant.lisansDurumu === 'SURESI_DOLDU') return true
  if (tenant.lisansDurumu === 'AKTIF' && isLicenseEndDatePassed(tenant)) return true
  return false
}

/** Büro girişi ve tüm tenant API’leri için temel kontrol. */
export function assertTenantLoginAllowed(tenant: Tenant): void {
  if (!tenant.aktifMi) {
    throw new AppError(
      403,
      'Büronuz pasif duruma alınmıştır. Lütfen Woontegra ile iletişime geçin.',
      'TENANT_INACTIVE'
    )
  }
  if (tenant.lisansDurumu === 'PASIF') {
    throw new AppError(403, 'Lisans durumu pasif. Lütfen Woontegra ile iletişime geçin.', 'LICENSE_INACTIVE')
  }
  if (tenant.lisansDurumu === 'DEMO' && demoExpired(tenant)) {
    throw new AppError(403, 'Demo süreniz sona erdi.', 'DEMO_EXPIRED')
  }
}

/**
 * Lisans okuma: PASIF / demo süresi dolmuş / büro pasif → engelle.
 * Yazma: SURESI_DOLDU veya (AKTIF + bitiş tarihi geçmiş) → yalnız GET/HEAD/OPTIONS.
 */
export async function assertTenantApiLicense(tenantId: string, method: string): Promise<TenantLicenseContext> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) {
    throw new AppError(403, 'Kiracı bulunamadı.', 'TENANT_NOT_FOUND')
  }
  assertTenantLoginAllowed(tenant)

  const readOnly = ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())

  if (isTenantLicenseWriteBlocked(tenant)) {
    if (!readOnly) {
      throw new AppError(403, LICENSE_WRITE_DENIED_MESSAGE, 'LICENSE_EXPIRED')
    }
    return { tenant, writeAllowed: false }
  }

  if (tenant.lisansDurumu === 'DEMO' && demoExpired(tenant)) {
    throw new AppError(403, 'Demo süreniz sona erdi.', 'DEMO_EXPIRED')
  }

  return { tenant, writeAllowed: true }
}

export function isLicenseBlockingStatus(s: TenantLicenseStatus): boolean {
  return s === 'PASIF'
}
