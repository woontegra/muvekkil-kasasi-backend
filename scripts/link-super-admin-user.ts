/**
 * SuperAdmin.linkedUserId ← Tenant User bağlama.
 * Production yazımı için açık onay + env bayrakları gerekir.
 *
 * Env:
 *   LINK_SUPER_ADMIN_EMAIL=info@woontegra.com
 *   LINK_TENANT_USER_ID=<uuid>          (veya LINK_TENANT_USER_EMAIL + LINK_TENANT_ID)
 *   LINK_APPLY=YES
 *   ADMIN_BOOTSTRAP_CONFIRM_PRODUCTION=YES  (Railway)
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { normalizeEmail } from '../src/admin/bootstrapOwnerAdmin.js'

function maskDb(raw: string | undefined): { host: string; port: string; db: string; railway: boolean } | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return {
      host: u.hostname,
      port: u.port || '(default)',
      db: u.pathname.replace(/^\//, '') || '(default)',
      railway: /railway|rlwy|proxy\.rlwy/i.test(u.hostname)
    }
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const meta = maskDb(process.env.DATABASE_URL)
  if (meta) {
    console.info(`[link] target DB host=${meta.host} port=${meta.port} db=${meta.db}`)
  } else {
    console.error('[link] DATABASE_URL yok')
    process.exit(1)
  }

  const apply = process.env.LINK_APPLY === 'YES'
  if (!apply) {
    console.info('[link] dry-run (LINK_APPLY≠YES). Yazma yapılmadı.')
  }
  if (meta.railway && process.env.ADMIN_BOOTSTRAP_CONFIRM_PRODUCTION !== 'YES') {
    console.error('[link] Railway için ADMIN_BOOTSTRAP_CONFIRM_PRODUCTION=YES gerekli.')
    process.exit(1)
  }

  const adminEmail = normalizeEmail(process.env.LINK_SUPER_ADMIN_EMAIL ?? 'info@woontegra.com')
  const userIdEnv = process.env.LINK_TENANT_USER_ID?.trim()
  const userEmail = process.env.LINK_TENANT_USER_EMAIL
    ? normalizeEmail(process.env.LINK_TENANT_USER_EMAIL)
    : adminEmail
  const tenantId = process.env.LINK_TENANT_ID?.trim()

  const prisma = new PrismaClient()
  try {
    const admin = await prisma.superAdmin.findFirst({
      where: { eposta: { equals: adminEmail, mode: 'insensitive' } }
    })
    if (!admin) {
      console.error(`[link] SuperAdmin bulunamadı: ${adminEmail}`)
      process.exit(1)
    }

    let user = userIdEnv ? await prisma.user.findUnique({ where: { id: userIdEnv } }) : null
    if (!user && tenantId) {
      user = await prisma.user.findFirst({
        where: {
          tenantId,
          eposta: { equals: userEmail, mode: 'insensitive' }
        }
      })
    }
    if (!user) {
      console.error('[link] Tenant User bulunamadı. LINK_TENANT_USER_ID veya LINK_TENANT_ID+email verin.')
      process.exit(1)
    }

    console.info('[link] plan:')
    console.info(`  SuperAdmin.id=${admin.id} email=${admin.eposta} rol=${admin.rol} aktif=${admin.aktifMi}`)
    console.info(`  User.id=${user.id} tenantId=${user.tenantId} email=${user.eposta} role=${user.role}`)
    console.info(`  SET super_admin.linked_user_id = ${user.id}`)
    console.info('  + revoke admin refresh sessions for this admin')

    if (!apply) {
      process.exit(0)
    }

    if (!admin.aktifMi || admin.rol !== 'SUPER_ADMIN') {
      console.error('[link] Hedef SuperAdmin aktif SUPER_ADMIN olmalı.')
      process.exit(1)
    }
    if (!user.aktifMi) {
      console.error('[link] Hedef User aktif olmalı.')
      process.exit(1)
    }

    await prisma.$transaction(async (tx) => {
      await tx.superAdmin.update({
        where: { id: admin.id },
        data: { linkedUserId: user!.id }
      })
      await tx.adminRefreshSession.updateMany({
        where: { adminId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() }
      })
    })
    console.info('[link] bağlandı.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
