import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

async function main() {
  const p = new PrismaClient()
  try {
    const t = await p.tenant.findUnique({
      where: { slug: 'woontegra' },
      select: {
        id: true,
        buroAdi: true,
        aktifMi: true,
        lisansDurumu: true,
        lisansBitisTarihi: true,
        demoMu: true
      }
    })
    console.info(
      'tenant',
      t
        ? {
            id: t.id.slice(0, 8) + '…',
            buroAdi: t.buroAdi,
            aktif: t.aktifMi,
            lisans: t.lisansDurumu,
            bitis: t.lisansBitisTarihi,
            demo: t.demoMu
          }
        : null
    )
    const u = await p.user.findMany({
      where: { eposta: { equals: 'info@woontegra.com', mode: 'insensitive' } },
      select: { id: true, tenantId: true, role: true, aktifMi: true }
    })
    console.info(
      'users',
      u.map((x) => ({
        id: x.id.slice(0, 8) + '…',
        tenant: x.tenantId.slice(0, 8) + '…',
        role: x.role,
        aktif: x.aktifMi
      }))
    )
    const a = await p.superAdmin.findMany({
      select: { id: true, eposta: true, rol: true, aktifMi: true, linkedUserId: true }
    })
    console.info(
      'admins',
      a.map((x) => ({
        id: x.id.slice(0, 8) + '…',
        eposta: x.eposta,
        rol: x.rol,
        aktif: x.aktifMi,
        linked: x.linkedUserId ? x.linkedUserId.slice(0, 8) + '…' : null
      }))
    )
    const open = await p.adminRefreshSession.count({ where: { revokedAt: null } })
    console.info('openAdminSessions', open)
  } finally {
    await p.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
