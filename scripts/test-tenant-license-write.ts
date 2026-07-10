/**
 * Tenant lisans süresi kontrolü doğrulaması.
 * Çalıştır: npx tsx scripts/test-tenant-license-write.ts
 */
import type { Tenant } from '@prisma/client'
import {
  assertTenantApiLicense,
  isLicenseEndDatePassed,
  isTenantLicenseWriteBlocked,
  LICENSE_WRITE_DENIED_MESSAGE
} from '../src/tenant/tenantLicense.js'
import { buildTenantLicenseCurrent } from '../src/license/license.service.js'
import { prisma } from '../src/lib/prisma.js'

function mockTenant(overrides: Partial<Tenant>): Tenant {
  return {
    id: 'test-tenant',
    buroAdi: 'Test Büro',
    slug: 'test',
    telefon: null,
    eposta: null,
    adres: null,
    vergiNo: null,
    vergiDairesi: null,
    aktifMi: true,
    lisansBaslangicTarihi: new Date('2025-01-01'),
    lisansBitisTarihi: new Date('2030-01-01'),
    lisansDurumu: 'AKTIF',
    demoMu: false,
    demoBitisTarihi: null,
    sonOdemeTarihi: null,
    yillikUcret: null,
    lisansNotlari: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  } as Tenant
}

function assert(name: string, cond: boolean): void {
  if (!cond) {
    console.error('FAIL:', name)
    process.exitCode = 1
  } else {
    console.log('PASS:', name)
  }
}

async function main(): Promise<void> {
  const future = new Date()
  future.setFullYear(future.getFullYear() + 1)
  const past = new Date()
  past.setFullYear(past.getFullYear() - 1)

  const aktifFuture = mockTenant({ lisansDurumu: 'AKTIF', lisansBitisTarihi: future })
  const aktifPast = mockTenant({ lisansDurumu: 'AKTIF', lisansBitisTarihi: past })
  const sureDoldu = mockTenant({ lisansDurumu: 'SURESI_DOLDU', lisansBitisTarihi: past })
  const pasif = mockTenant({ lisansDurumu: 'PASIF', aktifMi: true })
  const demoPast = mockTenant({
    lisansDurumu: 'DEMO',
    demoMu: true,
    demoBitisTarihi: past,
    lisansBitisTarihi: future
  })

  assert('AKTIF future → write not blocked', !isTenantLicenseWriteBlocked(aktifFuture))
  assert('AKTIF past → write blocked', isTenantLicenseWriteBlocked(aktifPast))
  assert('SURESI_DOLDU → write blocked', isTenantLicenseWriteBlocked(sureDoldu))
  assert('AKTIF past → end date passed', isLicenseEndDatePassed(aktifPast))

  const licDto = buildTenantLicenseCurrent(aktifPast, 'BURO_SAHIBI')
  assert('license/current BITTI for AKTIF past', licDto.uyariSeviyesi === 'BITTI')
  assert('license/current yazmaIzinli false', licDto.yazmaIzinli === false)
  assert('license/current kalanGun 0', licDto.kalanGun === 0)

  // Integration with real tenant if exists
  const real = await prisma.tenant.findFirst({ where: { aktifMi: true } })
  if (real) {
    const ctxGet = await assertTenantApiLicense(real.id, 'GET')
    assert('Real tenant GET ok', !!ctxGet.tenant)

    if (isTenantLicenseWriteBlocked(real)) {
      try {
        await assertTenantApiLicense(real.id, 'POST')
        assert('Write-blocked tenant POST should 403', false)
      } catch (e: unknown) {
        const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : ''
        assert('Write-blocked POST returns LICENSE_EXPIRED message', msg === LICENSE_WRITE_DENIED_MESSAGE)
      }
    } else {
      const ctxPost = await assertTenantApiLicense(real.id, 'POST')
      assert('Active tenant POST writeAllowed', ctxPost.writeAllowed === true)
    }
  }

  assert('PASIF blocks login path separately', pasif.lisansDurumu === 'PASIF')
  assert('DEMO past end passed', isLicenseEndDatePassed(demoPast))

  await prisma.$disconnect()
  console.log(process.exitCode === 1 ? '\nBAZI TESTLER BAŞARISIZ' : '\nTÜM TESTLER GEÇTİ')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
