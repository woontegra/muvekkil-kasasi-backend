import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const migPath = 'prisma/migrations/20260911153000_multi_currency/migration.sql'

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

async function main() {
  const localRaw = readFileSync(migPath)
  const localSha = sha256(localRaw)

  const rows = await prisma.$queryRawUnsafe<
    Array<{ migration_name: string; checksum: string; finished_at: Date | null }>
  >(
    `SELECT migration_name, checksum, finished_at
     FROM _prisma_migrations
     WHERE migration_name = $1`,
    '20260911153000_multi_currency'
  )

  const dbChecksum = rows[0]?.checksum ?? null
  console.log(
    JSON.stringify(
      {
        localSha256: localSha,
        localBytes: localRaw.length,
        dbChecksum,
        match: dbChecksum != null && dbChecksum === localSha
      },
      null,
      2
    )
  )
}

main()
  .catch((e) => {
    console.error(String(e?.message ?? e))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
