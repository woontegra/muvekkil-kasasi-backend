import { prisma } from '../src/lib/prisma.js'

const email = (process.argv[2] || 'info@optimoon.com').trim().toLowerCase()

async function main() {
  const users = await prisma.user.findMany({
    where: { eposta: { equals: email, mode: 'insensitive' } },
    include: {
      tenant: {
        select: {
          id: true,
          slug: true,
          buroAdi: true,
          lisansAnahtari: true,
          lisansDurumu: true,
          aktifMi: true,
          externalOrderId: true,
          externalCustomerId: true,
          lisansBaslangicTarihi: true,
          lisansBitisTarihi: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(
    JSON.stringify(
      {
        email,
        userCount: users.length,
        records: users.map((u) => ({
          userId: u.id,
          kullaniciAdi: u.kullaniciAdi,
          eposta: u.eposta,
          role: u.role,
          aktifMi: u.aktifMi,
          tenant: u.tenant,
        })),
      },
      null,
      2,
    ),
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
