/**
 * Temiz DB simülasyonu: 153000 sonra 170000 uygulanınca
 * Prisma schema’daki çoklu para birimi / TCMB alanları oluşur mu?
 * (Docker yok; production’a yazmaz.)
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const m153 = readFileSync('prisma/migrations/20260911153000_multi_currency/migration.sql', 'utf8')
const m170 = readFileSync(
  'prisma/migrations/20260911170000_add_missing_tcmb_currency_snapshot_columns/migration.sql',
  'utf8'
)

const dbChecksum = 'e6312a07f24f702c4de2a1e0859996806ca28e2e276763518a51d93df4c289e3'
const sha153 = createHash('sha256').update(readFileSync('prisma/migrations/20260911153000_multi_currency/migration.sql')).digest('hex')

type State = {
  enums: Record<string, Set<string>>
  columns: Record<string, Set<string>>
  indexes: Set<string>
}

function applySql(state: State, sql: string): void {
  // CREATE TYPE "X" AS ENUM ('A', 'B')
  for (const m of sql.matchAll(/CREATE TYPE\s+"(\w+)"\s+AS ENUM\s*\(([^)]+)\)/gi)) {
    const name = m[1]!
    const vals = m[2]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    state.enums[name] = new Set(vals)
  }
  // ALTER TYPE "X" ADD VALUE 'Y'
  for (const m of sql.matchAll(/ALTER TYPE\s+"(\w+)"\s+ADD VALUE(?:\s+IF NOT EXISTS)?\s+'([^']+)'/gi)) {
    const name = m[1]!
    state.enums[name] ||= new Set()
    state.enums[name]!.add(m[2]!)
  }
  // ALTER TABLE "t" ... ADD COLUMN "c"
  // and ADD COLUMN IF NOT EXISTS "c"
  const tableBlocks = sql.split(/ALTER TABLE\s+"/i).slice(1)
  for (const block of tableBlocks) {
    const table = block.match(/^(\w+)"/)?.[1]
    if (!table) continue
    state.columns[table] ||= new Set()
    for (const cm of block.matchAll(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"(\w+)"/gi)) {
      state.columns[table]!.add(cm[1]!)
    }
  }
  for (const m of sql.matchAll(/CREATE INDEX(?:\s+IF NOT EXISTS)?\s+"([^"]+)"/gi)) {
    state.indexes.add(m[1]!)
  }
}

const expectedColumns: Record<string, string[]> = {
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

const state: State = { enums: {}, columns: {}, indexes: new Set() }
applySql(state, m153)
const after153 = {
  hasKurKaynagiEnum: Boolean(state.enums.KurKaynagi),
  ofisHasKurKaynagi: state.columns.ofis_kasa_hareketi?.has('kur_kaynagi') ?? false,
  ofisHasParaBirimi: state.columns.ofis_kasa_hareketi?.has('para_birimi') ?? false
}
applySql(state, m170)

const missing: Array<{ table: string; column: string }> = []
for (const [t, cols] of Object.entries(expectedColumns)) {
  for (const c of cols) {
    if (!state.columns[t]?.has(c)) missing.push({ table: t, column: c })
  }
}

const ok =
  sha153 === dbChecksum &&
  Boolean(state.enums.ParaBirimi?.has('TRY')) &&
  Boolean(state.enums.KurKaynagi?.has('TCMB')) &&
  Boolean(state.enums.OfisKasaIslemTipi?.has('DOVIZ_CIKIS')) &&
  missing.length === 0 &&
  !after153.hasKurKaynagiEnum &&
  !after153.ofisHasKurKaynagi &&
  after153.ofisHasParaBirimi

console.log(
  JSON.stringify(
    {
      checksum153MatchesProduction: sha153 === dbChecksum,
      after153,
      afterBothMissing: missing,
      enums: Object.fromEntries(Object.entries(state.enums).map(([k, v]) => [k, [...v]])),
      cleanChainOk: ok
    },
    null,
    2
  )
)
