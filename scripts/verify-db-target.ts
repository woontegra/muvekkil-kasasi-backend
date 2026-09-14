import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const info = await prisma.$queryRawUnsafe<
    Array<{ current_database: string; inet_server_addr: string | null; current_user: string }>
  >(`SELECT current_database() AS current_database, inet_server_addr()::text AS inet_server_addr, current_user`)

  const hostHint = (process.env.DATABASE_URL ?? '')
    .replace(/:[^:@/]+@/, ':***@')
    .match(/@([^/:]+)/)?.[1] ?? '(host hidden)'

  console.log(
    JSON.stringify(
      {
        databaseName: info[0]?.current_database,
        dbUser: info[0]?.current_user,
        hostLooksLikeRailwayProxy: /rlwy\.net|railway/i.test(hostHint),
        hostLabel: hostHint.includes('rlwy.net') ? 'railway-proxy' : 'other'
      },
      null,
      2
    )
  )
}

main()
  .catch((e) => {
    console.error(String(e?.message ?? e).slice(0, 200))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
