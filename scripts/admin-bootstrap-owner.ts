/**
 * Tek seferlik / idempotent platform sahibi SuperAdmin bootstrap.
 *
 *   ADMIN_BOOTSTRAP_EMAIL=... ADMIN_BOOTSTRAP_PASSWORD=... npm run admin:bootstrap-owner
 *
 * Railway/production için ek olarak:
 *   ADMIN_BOOTSTRAP_CONFIRM_PRODUCTION=YES
 *
 * Parola terminalde yazdırılmaz; kaynak koda gömülmez.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { bootstrapOwnerAdmin, normalizeEmail } from '../src/admin/bootstrapOwnerAdmin.js'

function maskDatabaseUrl(raw: string | undefined): {
  host: string
  port: string
  db: string
  looksProductionOrRailway: boolean
} | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    const host = u.hostname
    const port = u.port || '(default)'
    const db = (u.pathname || '/').replace(/^\//, '').split('?')[0] || ''
    const looksProductionOrRailway = /railway|rlwy|proxy\.rlwy|amazonaws|\.prod\./i.test(host)
    return { host, port, db, looksProductionOrRailway }
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim()
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD
  const adSoyad = process.env.ADMIN_BOOTSTRAP_AD_SOYAD?.trim() || 'Woontegra Süper Admin'
  const kullaniciAdi = process.env.ADMIN_BOOTSTRAP_USERNAME?.trim()

  if (!email || !password) {
    console.error('[admin:bootstrap-owner] ADMIN_BOOTSTRAP_EMAIL ve ADMIN_BOOTSTRAP_PASSWORD zorunludur.')
    process.exit(1)
  }

  const dbMeta = maskDatabaseUrl(process.env.DATABASE_URL)
  if (!dbMeta) {
    console.error('[admin:bootstrap-owner] DATABASE_URL okunamadı.')
    process.exit(1)
  }

  console.info('[admin:bootstrap-owner] Hedef veritabanı (maskeli):')
  console.info(`  host: ${dbMeta.host}`)
  console.info(`  port: ${dbMeta.port}`)
  console.info(`  db:   ${dbMeta.db}`)
  console.info(`  production/railway: ${dbMeta.looksProductionOrRailway ? 'EVET' : 'hayır'}`)

  const prisma = new PrismaClient()
  try {
    const total = await prisma.superAdmin.count()
    const aktif = await prisma.superAdmin.count({ where: { aktifMi: true } })
    console.info(`  SuperAdmin toplam: ${total}`)
    console.info(`  Aktif admin: ${aktif}`)

    if (dbMeta.looksProductionOrRailway) {
      const confirm = process.env.ADMIN_BOOTSTRAP_CONFIRM_PRODUCTION?.trim()
      if (confirm !== 'YES') {
        console.error(
          '[admin:bootstrap-owner] Production/Railway hedefi. Yazma iptal.'
        )
        console.error(
          'Onay için ADMIN_BOOTSTRAP_CONFIRM_PRODUCTION=YES ile yeniden çalıştırın.'
        )
        process.exit(2)
      }
    }

    const result = await bootstrapOwnerAdmin(prisma, {
      email,
      password,
      adSoyad,
      kullaniciAdi
    })

    // Parola referansını mümkün olduğunca bırak
    ;(process.env as { ADMIN_BOOTSTRAP_PASSWORD?: string }).ADMIN_BOOTSTRAP_PASSWORD = undefined

    console.info(
      result.created
        ? '[admin:bootstrap-owner] SuperAdmin hesabı başarıyla oluşturuldu.'
        : '[admin:bootstrap-owner] SuperAdmin hesabı başarıyla güncellendi.'
    )
    console.info(
      JSON.stringify({
        email: normalizeEmail(email),
        created: result.created,
        updated: result.updated,
        deactivatedOtherCount: result.deactivatedOtherCount,
        revokedSessionCount: result.revokedSessionCount,
        aktifAdminCount: result.aktifAdminCount
      })
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('[admin:bootstrap-owner] Hata:', e instanceof Error ? e.message : e)
  process.exit(1)
})
