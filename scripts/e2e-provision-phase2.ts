/**
 * Phase-2 E2E: Tenant A (3 rol) + Tenant B (sahip) — yalnızca demo/E2E tenantlar.
 * Migration çalıştırmaz. Canlı müşteri tenantlarına dokunmaz.
 *
 *   npx tsx scripts/e2e-provision-phase2.ts
 */
import 'dotenv/config'
import bcrypt from 'bcrypt'
import type { UserRole } from '@prisma/client'
import { prisma } from '../src/lib/prisma.js'
import { provisionTenantWithOwner } from '../src/tenant/provisionTenantWithOwner.js'

const PASS = (process.env.E2E_OWNER_PASSWORD ?? process.env.E2E_PASSWORD ?? 'E2eTestPass123!').trim()
const NOTE = 'E2E phase2 otomatik test tenantı — müşteri verisi değil'

async function ensureTenant(opts: {
  buroAdi: string
  ownerUser: string
  ownerEmail: string
}): Promise<{ tenantId: string; ownerId: string }> {
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { kullaniciAdi: opts.ownerUser },
        { eposta: { equals: opts.ownerEmail, mode: 'insensitive' } }
      ]
    }
  })
  const sifreHash = await bcrypt.hash(PASS, 12)
  const now = new Date()
  const bitis = new Date(now)
  bitis.setFullYear(bitis.getFullYear() + 1)

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        sifreHash,
        mustChangePassword: false,
        aktifMi: true,
        role: 'BURO_SAHIBI',
        licenseActivatedAt: existing.licenseActivatedAt ?? now
      }
    })
    await prisma.tenant.update({
      where: { id: existing.tenantId },
      data: {
        aktifMi: true,
        buroAdi: opts.buroAdi,
        lisansDurumu: 'AKTIF',
        demoMu: true,
        lisansBaslangicTarihi: now,
        lisansBitisTarihi: bitis,
        demoBitisTarihi: bitis,
        lisansNotlari: NOTE
      }
    })
    return { tenantId: existing.tenantId, ownerId: existing.id }
  }

  const result = await provisionTenantWithOwner(
    {
      buroAdi: opts.buroAdi,
      eposta: opts.ownerEmail,
      aktifMi: true,
      lisansBaslangicTarihi: now,
      lisansBitisTarihi: bitis,
      lisansDurumu: 'AKTIF',
      demoMu: true,
      demoBitisTarihi: bitis,
      lisansNotlari: NOTE,
      owner: {
        adSoyad: 'E2E Phase2 Sahip',
        kullaniciAdi: opts.ownerUser,
        eposta: opts.ownerEmail,
        sifreHash,
        mustChangePassword: false,
        licenseActivatedAt: now
      }
    },
    { source: 'WOONTEGRA_WEBSITE', ipAddress: '127.0.0.1', userAgent: 'e2e-provision-phase2' }
  )
  return { tenantId: result.tenant.id, ownerId: result.ownerUser.id }
}

async function ensureStaff(
  tenantId: string,
  user: string,
  role: UserRole,
  adSoyad: string
): Promise<void> {
  const email = `${user}@e2e.local`
  const sifreHash = await bcrypt.hash(PASS, 12)
  const now = new Date()
  const existing = await prisma.user.findFirst({
    where: { OR: [{ kullaniciAdi: user }, { eposta: { equals: email, mode: 'insensitive' } }] }
  })
  if (existing) {
    if (existing.tenantId !== tenantId) {
      throw new Error(`[e2e-provision-phase2] ${user} başka tenantta: ${existing.tenantId}`)
    }
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        sifreHash,
        role,
        aktifMi: true,
        mustChangePassword: false,
        licenseActivatedAt: existing.licenseActivatedAt ?? now,
        adSoyad
      }
    })
    return
  }
  await prisma.user.create({
    data: {
      tenantId,
      adSoyad,
      kullaniciAdi: user,
      eposta: email,
      sifreHash,
      role,
      aktifMi: true,
      mustChangePassword: false,
      licenseActivatedAt: now
    }
  })
}

async function main(): Promise<void> {
  const a = await ensureTenant({
    buroAdi: 'E2E Phase2 Büro A',
    ownerUser: 'e2e.sahip',
    ownerEmail: 'e2e.sahip@e2e.local'
  })
  await ensureStaff(a.tenantId, 'e2e.avukat', 'AVUKAT_YONETICI', 'E2E Avukat Yönetici')
  await ensureStaff(a.tenantId, 'e2e.katip', 'KATIP_PERSONEL', 'E2E Katip Personel')

  const b = await ensureTenant({
    buroAdi: 'E2E Phase2 Büro B',
    ownerUser: 'e2e.b.sahip',
    ownerEmail: 'e2e.b.sahip@e2e.local'
  })

  console.info('[e2e-provision-phase2] Tenant A=', a.tenantId)
  console.info('[e2e-provision-phase2] Tenant B=', b.tenantId)
  console.info('[e2e-provision-phase2] users: e2e.sahip, e2e.avukat, e2e.katip, e2e.b.sahip')
  console.info('[e2e-provision-phase2] password: E2E_PASSWORD / E2E_OWNER_PASSWORD (env)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
