/**
 * Idempotent production provision:
 * - Woontegra tenant (slug=woontegra)
 * - info@woontegra.com User (BURO_SAHIBI)
 * - Link/update existing SuperAdmin → info@ + linkedUserId
 * - Revoke all admin refresh sessions
 *
 * Gereksinimler:
 *   ADMIN_BOOTSTRAP_PASSWORD (düz parola; loglanmaz)
 *   ADMIN_BOOTSTRAP_CONFIRM_PRODUCTION=YES
 *   WOONTEGRA_PROVISION_APPLY=YES
 *   RAILWAY_BACKUP_VERIFIED=YES  (yedek doğrulandıktan sonra)
 *
 * Migration ayrı: prisma migrate deploy
 */
import 'dotenv/config'
import bcrypt from 'bcrypt'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { BCRYPT_COST, normalizeEmail } from '../src/admin/bootstrapOwnerAdmin.js'

const EMAIL = 'info@woontegra.com'
const SLUG = 'woontegra'
const BURO = 'Woontegra'
const LICENSE_END = new Date('2099-12-31T23:59:59.000Z')

function maskDb(raw: string | undefined) {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return { host: u.hostname, port: u.port || '(default)', db: u.pathname.replace(/^\//, '') }
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const meta = maskDb(process.env.DATABASE_URL)
  console.info('[provision] DB', meta)

  if (process.env.RAILWAY_BACKUP_VERIFIED !== 'YES') {
    console.error('[provision] RAILWAY_BACKUP_VERIFIED≠YES — yazma yok.')
    process.exit(1)
  }
  if (process.env.ADMIN_BOOTSTRAP_CONFIRM_PRODUCTION !== 'YES') {
    console.error('[provision] ADMIN_BOOTSTRAP_CONFIRM_PRODUCTION≠YES — yazma yok.')
    process.exit(1)
  }
  if (process.env.WOONTEGRA_PROVISION_APPLY !== 'YES') {
    console.error('[provision] WOONTEGRA_PROVISION_APPLY≠YES — yazma yok.')
    process.exit(1)
  }

  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD
  if (!password || password.length < 10) {
    console.error('[provision] ADMIN_BOOTSTRAP_PASSWORD eksik veya çok kısa.')
    process.exit(1)
  }

  // bcrypt transaction dışında — interactive tx timeout’u aşmasın
  const sifreHash = await bcrypt.hash(password, BCRYPT_COST)

  const prisma = new PrismaClient()
  try {
    const result = await prisma.$transaction(
      async (tx) => {
      const col = await tx.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'super_admin' AND column_name = 'linked_user_id'
         ) AS exists`
      )
      if (!col[0]?.exists) {
        throw new Error('linked_user_id kolonu yok — önce migrate deploy çalıştırın.')
      }

      let tenant = await tx.tenant.findUnique({ where: { slug: SLUG } })
      let tenantCreated = false
      if (!tenant) {
        tenant = await tx.tenant.create({
          data: {
            buroAdi: BURO,
            slug: SLUG,
            eposta: EMAIL,
            aktifMi: true,
            demoMu: false,
            lisansDurumu: 'AKTIF',
            lisansBaslangicTarihi: new Date(),
            lisansBitisTarihi: LICENSE_END,
            lisansNotlari: 'OZEL — Woontegra platform yönetim hesabı (müşteri bürosu değil)',
            lisansAnahtari: `WTG-OZEL-${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`
          }
        })
        tenantCreated = true
      } else {
        tenant = await tx.tenant.update({
          where: { id: tenant.id },
          data: {
            buroAdi: BURO,
            aktifMi: true,
            demoMu: false,
            lisansDurumu: 'AKTIF',
            lisansBitisTarihi: LICENSE_END,
            lisansNotlari: 'OZEL — Woontegra platform yönetim hesabı (müşteri bürosu değil)'
          }
        })
      }

      const email = normalizeEmail(EMAIL)

      let user = await tx.user.findFirst({
        where: { eposta: { equals: email, mode: 'insensitive' } }
      })
      let userCreated = false
      if (user) {
        if (user.tenantId !== tenant.id) {
          throw new Error('info@ User başka bir tenant altında — manuel inceleme gerekli.')
        }
        user = await tx.user.update({
          where: { id: user.id },
          data: {
            adSoyad: 'Woontegra Süper Admin',
            role: 'BURO_SAHIBI',
            aktifMi: true,
            sifreHash,
            mustChangePassword: false,
            licenseActivatedAt: user.licenseActivatedAt ?? new Date()
          }
        })
      } else {
        const baseUser = 'info.woontegra'
        let kullaniciAdi = baseUser
        if (await tx.user.findUnique({ where: { kullaniciAdi } })) {
          kullaniciAdi = `info.wtg.${Date.now().toString(36)}`.slice(0, 48)
        }
        user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            adSoyad: 'Woontegra Süper Admin',
            kullaniciAdi,
            eposta: email,
            sifreHash,
            role: 'BURO_SAHIBI',
            aktifMi: true,
            mustChangePassword: false,
            licenseActivatedAt: new Date()
          }
        })
        userCreated = true
      }

      const adminByOld = await tx.superAdmin.findFirst({
        where: { eposta: { equals: 'admin@woontegra.com', mode: 'insensitive' } }
      })
      const adminByNew = await tx.superAdmin.findFirst({
        where: { eposta: { equals: email, mode: 'insensitive' } }
      })
      let admin = adminByNew ?? adminByOld
      if (!admin) {
        throw new Error('Aktif SuperAdmin kaydı bulunamadı — silmeden güncelleme bekleniyordu.')
      }

      admin = await tx.superAdmin.update({
        where: { id: admin.id },
        data: {
          eposta: email,
          adSoyad: 'Woontegra Süper Admin',
          rol: 'SUPER_ADMIN',
          aktifMi: true,
          linkedUserId: user.id,
          sifreHash
        }
      })

      await tx.superAdmin.updateMany({
        where: { aktifMi: true, NOT: { id: admin.id } },
        data: { aktifMi: false }
      })

      const revoked = await tx.adminRefreshSession.updateMany({
        where: { revokedAt: null },
        data: { revokedAt: new Date() }
      })

      const aktifCount = await tx.superAdmin.count({ where: { aktifMi: true } })
      if (aktifCount !== 1) {
        throw new Error(`Beklenen 1 aktif SuperAdmin, bulunan: ${aktifCount}`)
      }

      await tx.adminAuditLog.create({
        data: {
          adminId: admin.id,
          action: 'WOONTEGRA_PLATFORM_PROVISION',
          entityType: 'SuperAdmin',
          entityId: admin.id,
          newValue: {
            tenantSlug: SLUG,
            tenantCreated,
            userCreated,
            linkedUserId: user.id,
            emailUpdatedTo: email,
            revokedAdminSessions: revoked.count,
            paketNote: 'OZEL'
          }
        }
      })

      return {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantCreated,
        userId: user.id,
        userCreated,
        adminId: admin.id,
        adminEmail: admin.eposta,
        linkedUserId: admin.linkedUserId,
        aktifAdminCount: aktifCount,
        revokedAdminSessions: revoked.count
      }
    },
      { maxWait: 15_000, timeout: 30_000 }
    )

    console.info('[provision] OK', {
      ...result,
      tenantId: result.tenantId.slice(0, 8) + '…',
      userId: result.userId.slice(0, 8) + '…',
      adminId: result.adminId.slice(0, 8) + '…',
      linkedUserId: result.linkedUserId ? result.linkedUserId.slice(0, 8) + '…' : null
    })
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('[provision] FAIL', e instanceof Error ? e.message : e)
  process.exit(1)
})
