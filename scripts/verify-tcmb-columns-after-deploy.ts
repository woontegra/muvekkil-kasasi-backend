import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import jwt from 'jsonwebtoken'
import { TENANT_JWT_AUD, TENANT_JWT_ISS } from '../src/auth/jwt.js'

const prisma = new PrismaClient()

const expected = [
  { table: 'ofis_kasa_hareketi', column: 'kur_kaynagi' },
  { table: 'ofis_kasa_hareketi', column: 'tcmb_kur_tarihi' },
  { table: 'ofis_kasa_hareketi', column: 'tcmb_referans_kur' },
  { table: 'vekalet_taksit_odeme', column: 'kur_kaynagi' },
  { table: 'vekalet_taksit_odeme', column: 'tcmb_kur_tarihi' },
  { table: 'vekalet_taksit_odeme', column: 'tcmb_referans_kur' },
  { table: 'vekalet_taksit_odeme', column: 'prim_try_matrahi' },
  { table: 'icra_tahsilat_odeme', column: 'kur_kaynagi' },
  { table: 'icra_tahsilat_odeme', column: 'tcmb_kur_tarihi' },
  { table: 'icra_tahsilat_odeme', column: 'tcmb_referans_kur' },
  { table: 'icra_tahsilat_odeme', column: 'prim_try_matrahi' }
]

async function main() {
  const mig = await prisma.$queryRawUnsafe<
    Array<{ migration_name: string; finished_at: Date | null; checksum: string }>
  >(
    `SELECT migration_name, finished_at, checksum FROM _prisma_migrations
     WHERE migration_name = $1`,
    '20260911170000_add_missing_tcmb_currency_snapshot_columns'
  )

  const enums = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(
    `SELECT e.enumlabel FROM pg_type t
     JOIN pg_enum e ON t.oid = e.enumtypid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typname = 'KurKaynagi'
     ORDER BY e.enumsortorder`
  )

  const cols = await prisma.$queryRawUnsafe<
    Array<{ table_name: string; column_name: string }>
  >(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (
         (table_name = 'ofis_kasa_hareketi' AND column_name IN ('kur_kaynagi','tcmb_kur_tarihi','tcmb_referans_kur'))
         OR (table_name IN ('vekalet_taksit_odeme','icra_tahsilat_odeme')
             AND column_name IN ('kur_kaynagi','tcmb_kur_tarihi','tcmb_referans_kur','prim_try_matrahi'))
       )
     ORDER BY table_name, column_name`
  )

  const have = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`))
  const missing = expected.filter((e) => !have.has(`${e.table}.${e.column}`))

  console.log(
    JSON.stringify(
      {
        migrationRecorded: Boolean(mig[0]?.finished_at),
        migrationFinishedAt: mig[0]?.finished_at ?? null,
        kurKaynagiValues: enums.map((e) => e.enumlabel),
        columnsFound: [...have].sort(),
        missing,
        allElevenPresent: missing.length === 0
      },
      null,
      2
    )
  )
}

main()
  .catch((e) => {
    console.error(String(e?.message ?? e).slice(0, 300))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
