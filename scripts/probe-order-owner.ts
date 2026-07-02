/**
 * Read-only probe: WNT-20260701-000016 tenant/owner diagnostics.
 * Usage: npx tsx scripts/probe-order-owner.ts [orderNoPrefix]
 * Does NOT log plain passwords.
 */
import bcrypt from 'bcrypt'
import { prisma } from '../src/lib/prisma.js'

const ORDER_PREFIX = (process.argv[2] ?? 'WNT-20260701-000016').trim()

async function main(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: {
      OR: [
        { externalOrderId: { startsWith: ORDER_PREFIX } },
        { externalOrderId: { contains: ORDER_PREFIX } },
      ],
    },
    include: {
      users: {
        where: { role: 'BURO_SAHIBI' },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  console.log(JSON.stringify({ orderPrefix: ORDER_PREFIX, tenantCount: tenants.length }, null, 2))

  for (const t of tenants) {
    const owner = t.users[0] ?? null
    console.log(
      JSON.stringify(
        {
          tenant: {
            id: t.id,
            buroAdi: t.buroAdi,
            slug: t.slug,
            lisansAnahtari: t.lisansAnahtari,
            lisansDurumu: t.lisansDurumu,
            aktifMi: t.aktifMi,
            externalOrderId: t.externalOrderId,
            externalCustomerId: t.externalCustomerId,
            lisansBaslangic: t.lisansBaslangicTarihi?.toISOString() ?? null,
            lisansBitis: t.lisansBitisTarihi?.toISOString() ?? null,
            createdAt: t.createdAt.toISOString(),
          },
          owner: owner
            ? {
                id: owner.id,
                eposta: owner.eposta,
                kullaniciAdi: owner.kullaniciAdi,
                aktifMi: owner.aktifMi,
                role: owner.role,
                tenantId: owner.tenantId,
                hasSifreHash: Boolean(owner.sifreHash?.trim()),
                sifreHashPrefix: owner.sifreHash?.slice(0, 7) ?? null,
                createdAt: owner.createdAt.toISOString(),
              }
            : null,
        },
        null,
        2,
      ),
    )
  }

  const email = 'woontegra@hotmail.com'
  const emailUsers = await prisma.user.findMany({
    where: { eposta: { equals: email, mode: 'insensitive' }, aktifMi: true },
    select: {
      id: true,
      kullaniciAdi: true,
      eposta: true,
      tenantId: true,
      role: true,
      createdAt: true,
      tenant: { select: { slug: true, externalOrderId: true, lisansDurumu: true, aktifMi: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(
    JSON.stringify(
      {
        emailLookup: email,
        activeUserCount: emailUsers.length,
        ambiguousEmailLogin: emailUsers.length > 1,
        users: emailUsers.map((u) => ({
          id: u.id,
          kullaniciAdi: u.kullaniciAdi,
          tenantId: u.tenantId,
          tenantSlug: u.tenant.slug,
          tenantExternalOrderId: u.tenant.externalOrderId,
          lisansDurumu: u.tenant.lisansDurumu,
          tenantAktifMi: u.tenant.aktifMi,
          createdAt: u.createdAt.toISOString(),
        })),
      },
      null,
      2,
    ),
  )

  const testPassword = process.env.PROBE_TEMP_PASSWORD?.trim()
  if (testPassword && tenants.length > 0) {
    const owner = tenants[0]!.users[0]
    if (owner?.sifreHash) {
      const temporaryPasswordMatchesHash = await bcrypt.compare(testPassword, owner.sifreHash)
      console.log(JSON.stringify({ temporaryPasswordMatchesHash, probedUserId: owner.id }, null, 2))
    }
  } else {
    console.log(
      JSON.stringify(
        {
          temporaryPasswordMatchesHash: null,
          note: 'Set PROBE_TEMP_PASSWORD env to compare mail password against hash (not logged).',
        },
        null,
        2,
      ),
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
