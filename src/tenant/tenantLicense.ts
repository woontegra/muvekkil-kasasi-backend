import type { Tenant, TenantLicenseStatus } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'

export type TenantLicenseContext = {
  tenant: Tenant
  writeAllowed: boolean
}

function demoExpired(tenant: Tenant): boolean {
  if (!tenant.demoMu || !tenant.demoBitisTarihi) return false
  return tenant.demoBitisTarihi < new Date()
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
 * Lisans okuma: PASIF lisans veya demo süresi dolmuş veya büro pasif → engelle.
 * Yazma: AKTIF veya (DEMO ve süresi geçerli). SURESI_DOLDU → yalnız GET/HEAD/OPTIONS.
 */
export async function assertTenantApiLicense(tenantId: string, method: string): Promise<TenantLicenseContext> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) {
    throw new AppError(403, 'Kiracı bulunamadı.', 'TENANT_NOT_FOUND')
  }
  assertTenantLoginAllowed(tenant)

  const readOnly = ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())

  if (tenant.lisansDurumu === 'SURESI_DOLDU') {
    if (!readOnly) {
      throw new AppError(
        403,
        'Lisans süreniz sona erdi. Görüntüleme yapabilirsiniz; yeni kayıt ve düzenleme kapalıdır.',
        'LICENSE_EXPIRED'
      )
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
