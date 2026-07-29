/**
 * İzole E2E test tenant + büro sahibi oluşturur / şifresini yeniler.
 * Migration çalıştırmaz. Canlı müşteri tenantlarına dokunmaz.
 *
 *   cd muvekkil-kasasi-backend
 *   npx tsx scripts/e2e-provision-test-tenant.ts
 */
import 'dotenv/config'
import bcrypt from 'bcrypt'
import { prisma } from '../src/lib/prisma.js'
import { provisionTenantWithOwner } from '../src/tenant/provisionTenantWithOwner.js'

async function main(): Promise<void> {
  const ownerUser = (process.env.E2E_OWNER_USER ?? 'e2e.sahip').trim().toLowerCase()
  const ownerPass = (process.env.E2E_OWNER_PASSWORD ?? 'E2eTestPass123!').trim()
  const buroAdi = (process.env.E2E_BURO_ADI ?? 'E2E Test Büro').trim()
  const ownerEmail = (process.env.E2E_OWNER_EMAIL ?? `${ownerUser}@e2e.local`).trim().toLowerCase()

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ kullaniciAdi: ownerUser }, { eposta: { equals: ownerEmail, mode: 'insensitive' } }]
    }
  })

  const sifreHash = await bcrypt.hash(ownerPass, 12)
  const now = new Date()
  const bitis = new Date(now)
  bitis.setFullYear(bitis.getFullYear() + 1)

  if (existingUser) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        sifreHash,
        mustChangePassword: false,
        aktifMi: true,
        role: 'BURO_SAHIBI',
        licenseActivatedAt: existingUser.licenseActivatedAt ?? now
      }
    })
    await prisma.tenant.update({
      where: { id: existingUser.tenantId },
      data: {
        aktifMi: true,
        buroAdi,
        lisansDurumu: 'AKTIF',
        demoMu: true,
        lisansBaslangicTarihi: now,
        lisansBitisTarihi: bitis,
        demoBitisTarihi: bitis,
        lisansNotlari: 'E2E otomatik test tenantı — müşteri verisi değil'
      }
    })
    console.info('[e2e-provision] Mevcut test kullanıcısı güncellendi:', ownerUser)
    console.info('[e2e-provision] tenantId=', existingUser.tenantId)
    return
  }

  const result = await provisionTenantWithOwner(
    {
      buroAdi,
      eposta: ownerEmail,
      aktifMi: true,
      lisansBaslangicTarihi: now,
      lisansBitisTarihi: bitis,
      lisansDurumu: 'AKTIF',
      demoMu: true,
      demoBitisTarihi: bitis,
      lisansNotlari: 'E2E otomatik test tenantı — müşteri verisi değil',
      owner: {
        adSoyad: 'E2E Test Sahip',
        kullaniciAdi: ownerUser,
        eposta: ownerEmail,
        sifreHash,
        mustChangePassword: false,
        licenseActivatedAt: now
      }
    },
    {
      source: 'WOONTEGRA_WEBSITE',
      ipAddress: '127.0.0.1',
      userAgent: 'e2e-provision-script'
    }
  )

  console.info('[e2e-provision] Yeni test tenant oluşturuldu')
  console.info('[e2e-provision] user=', ownerUser, 'tenantId=', result.tenant.id)
  console.info('[e2e-provision] Frontend: e2e/.env.e2e → E2E_USER / E2E_PASSWORD')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
