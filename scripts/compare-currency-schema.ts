import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const tables = [
  'ofis_kasa_hareketi',
  'vekalet_ucreti',
  'vekalet_taksiti',
  'vekalet_taksit_odeme',
  'icra_tahsilat_alacak',
  'icra_tahsilat_taksit',
  'icra_tahsilat_odeme'
] as const

const expected: Record<string, string[]> = {
  ofis_kasa_hareketi: [
    'para_birimi',
    'doviz_donusum_id',
    'kur',
    'kur_baz_para_birimi',
    'kur_karsi_para_birimi',
    'kur_kaynagi',
    'tcmb_kur_tarihi',
    'tcmb_referans_kur'
  ],
  vekalet_ucreti: ['para_birimi'],
  vekalet_taksiti: ['para_birimi'],
  vekalet_taksit_odeme: [
    'kasa_tutari',
    'alacak_para_birimi',
    'odeme_para_birimi',
    'kur',
    'kur_baz_para_birimi',
    'kur_karsi_para_birimi',
    'kur_kaynagi',
    'tcmb_kur_tarihi',
    'tcmb_referans_kur',
    'prim_try_matrahi'
  ],
  icra_tahsilat_alacak: ['para_birimi'],
  icra_tahsilat_taksit: ['para_birimi'],
  icra_tahsilat_odeme: [
    'kasa_tutari',
    'alacak_para_birimi',
    'odeme_para_birimi',
    'kur',
    'kur_baz_para_birimi',
    'kur_karsi_para_birimi',
    'kur_kaynagi',
    'tcmb_kur_tarihi',
    'tcmb_referans_kur',
    'prim_try_matrahi'
  ]
}

const expectedIndexes = [
  'ofis_kasa_hareketi_tenant_id_para_birimi_tarih_idx',
  'ofis_kasa_hareketi_tenant_id_doviz_donusum_id_idx',
  'vekalet_ucreti_tenant_id_para_birimi_idx',
  'icra_tahsilat_alacak_tenant_id_para_birimi_idx'
]

async function main() {
  const cols = await prisma.$queryRawUnsafe<
    Array<{
      table_name: string
      column_name: string
      data_type: string
      udt_name: string
      is_nullable: string
      column_default: string | null
    }>
  >(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name, ordinal_position`,
    tables as unknown as string[]
  )

  const byTable: Record<string, string[]> = {}
  for (const c of cols) {
    ;(byTable[c.table_name] ||= []).push(c.column_name)
  }

  const missing: Array<{ table: string; column: string }> = []
  const present: Array<{ table: string; column: string }> = []
  for (const [t, list] of Object.entries(expected)) {
    const have = new Set(byTable[t] || [])
    for (const col of list) {
      if (have.has(col)) present.push({ table: t, column: col })
      else missing.push({ table: t, column: col })
    }
  }

  const enums = await prisma.$queryRawUnsafe<
    Array<{ enum_name: string; enum_value: string }>
  >(
    `SELECT t.typname AS enum_name, e.enumlabel AS enum_value
     FROM pg_type t
     JOIN pg_enum e ON t.oid = e.enumtypid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typname IN ('ParaBirimi','KurKaynagi','OfisKasaIslemTipi')
     ORDER BY t.typname, e.enumsortorder`
  )

  const indexes = await prisma.$queryRawUnsafe<
    Array<{ tablename: string; indexname: string }>
  >(
    `SELECT tablename, indexname
     FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = ANY($1::text[])
     ORDER BY tablename, indexname`,
    tables as unknown as string[]
  )
  const indexNames = new Set(indexes.map((i) => i.indexname))
  const missingIndexes = expectedIndexes.filter((n) => !indexNames.has(n))

  const mig = await prisma.$queryRawUnsafe<
    Array<{ migration_name: string; finished_at: Date | null }>
  >(
    `SELECT migration_name, finished_at FROM _prisma_migrations
     WHERE migration_name LIKE '%20260911%' OR migration_name LIKE '%multi_currency%' OR migration_name LIKE '%tcmb%'
     ORDER BY finished_at NULLS LAST`
  )

  const nullableIssues: Array<{ table: string; column: string; is_nullable: string }> = []
  for (const c of cols) {
    if (c.column_name === 'kasa_tutari' && c.is_nullable === 'YES') {
      nullableIssues.push({ table: c.table_name, column: c.column_name, is_nullable: c.is_nullable })
    }
  }

  console.log(
    JSON.stringify(
      {
        missing,
        present,
        missingIndexes,
        enums,
        mig,
        nullableIssues,
        currencyLikePresent: Object.fromEntries(
          Object.entries(byTable).map(([k, v]) => [
            k,
            v.filter((c) =>
              /para_birimi|kasa_tutari|kur|tcmb|prim_try|doviz_donusum|alacak_para|odeme_para/.test(c)
            )
          ])
        )
      },
      null,
      2
    )
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
