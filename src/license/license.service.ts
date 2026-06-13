import type { Tenant, UserRole } from '@prisma/client'

export type LicenseWarningLevel = 'NORMAL' | 'YAKLASIYOR' | 'KRITIK' | 'BITTI' | 'PASIF' | 'BILGI_EKSIK'

export type TenantLicenseCurrentDto = {
  tenantId: string
  buroAdi: string
  lisansDurumu: Tenant['lisansDurumu']
  lisansBaslangicTarihi: string | null
  lisansBitisTarihi: string | null
  demoMu: boolean
  demoBitisTarihi: string | null
  kalanGun: number | null
  uyariSeviyesi: LicenseWarningLevel
  /** Bitiş tarihi yokken kullanıcıya gösterilecek kısa açıklama. */
  bilgiMesaji?: string | null
  /** Yalnız `BURO_SAHIBI` için dolu. */
  yillikUcret?: string | null
}

function startOfTodayLocal(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Takvim günü farkı (bitiş günü 00:00 ile bugün 00:00). */
function calendarDaysFromTodayTo(end: Date): number {
  const today = startOfTodayLocal()
  const e = new Date(end)
  e.setHours(0, 0, 0, 0)
  return Math.round((e.getTime() - today.getTime()) / 86_400_000)
}

function dec(d: { toString: () => string } | null | undefined): string | null {
  if (d == null) return null
  return d.toString()
}

function effectiveLicenseEnd(tenant: Tenant): Date | null {
  if (tenant.lisansDurumu === 'DEMO' && tenant.demoMu && tenant.demoBitisTarihi) {
    return tenant.demoBitisTarihi
  }
  return tenant.lisansBitisTarihi
}

/** Bitiş tarihi varken kalan güne göre uyarı (PASIF / SURESI_DOLDU ayrı ele alınır). */
function uyariFromRemainingDays(rawDays: number): LicenseWarningLevel {
  if (rawDays < 0) return 'BITTI'
  if (rawDays <= 7) return 'KRITIK'
  if (rawDays <= 30) return 'YAKLASIYOR'
  return 'NORMAL'
}

export function buildTenantLicenseCurrent(tenant: Tenant, role: UserRole): TenantLicenseCurrentDto {
  const tenantId = tenant.id
  const buroAdi = tenant.buroAdi
  const fullDetail = role === 'BURO_SAHIBI' || role === 'AVUKAT_YONETICI'
  const katip = role === 'KATIP_PERSONEL'

  const end = effectiveLicenseEnd(tenant)
  const rawDays = end ? calendarDaysFromTodayTo(end) : null
  const kalanGun = rawDays == null ? null : Math.max(0, rawDays)

  let uyariSeviyesi: LicenseWarningLevel
  let bilgiMesaji: string | null = null

  if (!tenant.aktifMi || tenant.lisansDurumu === 'PASIF') {
    uyariSeviyesi = 'PASIF'
  } else if (tenant.lisansDurumu === 'SURESI_DOLDU') {
    uyariSeviyesi = 'BITTI'
  } else if (!end) {
    uyariSeviyesi = 'BILGI_EKSIK'
    bilgiMesaji = 'Lisans bitiş tarihi henüz tanımlanmamış.'
  } else {
    uyariSeviyesi = uyariFromRemainingDays(rawDays!)
  }

  const lisansBaslangicTarihi = fullDetail ? tenant.lisansBaslangicTarihi?.toISOString() ?? null : null
  const lisansBitisTarihi = fullDetail || katip ? tenant.lisansBitisTarihi?.toISOString() ?? null : null
  const demoBitisTarihi = fullDetail ? tenant.demoBitisTarihi?.toISOString() ?? null : katip && tenant.demoMu ? tenant.demoBitisTarihi?.toISOString() ?? null : null

  return {
    tenantId,
    buroAdi,
    lisansDurumu: tenant.lisansDurumu,
    lisansBaslangicTarihi,
    lisansBitisTarihi,
    demoMu: tenant.demoMu,
    demoBitisTarihi,
    kalanGun,
    uyariSeviyesi,
    bilgiMesaji,
    ...(role === 'BURO_SAHIBI' ? { yillikUcret: dec(tenant.yillikUcret) } : {})
  }
}
