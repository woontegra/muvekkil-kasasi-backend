import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

function maskDb(raw: string | undefined) {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return { host: u.hostname, port: u.port || '(default)', db: u.pathname.replace(/^\//, '') }
  } catch {
    return null
  }
}

async function main() {
  console.info('DB', maskDb(process.env.DATABASE_URL))
  const p = new PrismaClient()
  try {
    const info = await p.user.findMany({
      where: { eposta: { equals: 'info@woontegra.com', mode: 'insensitive' } },
      select: { id: true, tenantId: true, eposta: true, role: true, aktifMi: true, kullaniciAdi: true }
    })
    console.info(
      'info@ users',
      info.map((u) => ({
        ...u,
        id: u.id.slice(0, 8) + '…',
        tenantId: u.tenantId.slice(0, 8) + '…'
      }))
    )

    const col = await p.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'super_admin' AND column_name = 'linked_user_id'
       ) AS exists`
    )
    console.info('linked_user_id column exists', col[0]?.exists)

    const admins = await p.$queryRawUnsafe<
      {
        id: string
        eposta: string | null
        kullanici_adi: string
        rol: string
        aktif_mi: boolean
      }[]
    >(
      `SELECT id, eposta, kullanici_adi, rol::text AS rol, aktif_mi
       FROM super_admin
       ORDER BY created_at DESC
       LIMIT 20`
    )
    console.info(
      'superAdmins',
      admins.map((a) => ({
        id: a.id.slice(0, 8) + '…',
        eposta: a.eposta,
        kullaniciAdi: a.kullanici_adi,
        rol: a.rol,
        aktif: a.aktif_mi
      }))
    )

    const tenants = await p.tenant.findMany({
      take: 40,
      orderBy: { createdAt: 'desc' },
      select: { id: true, buroAdi: true, slug: true, aktifMi: true, eposta: true }
    })
    console.info(
      'tenants',
      tenants.map((t) => ({
        id: t.id.slice(0, 8) + '…',
        buroAdi: t.buroAdi,
        slug: t.slug,
        eposta: t.eposta,
        aktif: t.aktifMi
      }))
    )
    const woon = tenants.filter((t) =>
      /woon|wtg|platform/i.test(`${t.buroAdi ?? ''}${t.slug ?? ''}${t.eposta ?? ''}`)
    )
    console.info('woon-like tenants', woon.length ? woon : '(none)')
  } finally {
    await p.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
