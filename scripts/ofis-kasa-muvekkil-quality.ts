/**
 * Ofis kasası ↔ müvekkil bağlantısı — şema / iş kuralı kalite kontrolleri.
 * Railway production DB’ye yazmaz; API smoke yalnız local/E2E ortamında çalışır.
 *
 *   npx tsx scripts/ofis-kasa-muvekkil-quality.ts
 */
import 'dotenv/config'
import { createOfisKasaHareketiBodySchema } from '../src/ofisKasa/ofisKasa.schemas.js'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail })
  console.info(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function isRailwayDb(url: string | undefined): boolean {
  if (!url) return false
  return /rlwy\.net|railway\.app|railway\.internal/i.test(url)
}

const baseGelir = {
  islemTipi: 'GELIR' as const,
  tarih: new Date().toISOString(),
  kategori: 'Danışmanlık geliri',
  tutar: 100,
  odemeYontemi: 'NAKIT' as const
}

const baseGider = {
  islemTipi: 'GIDER' as const,
  tarih: new Date().toISOString(),
  kategori: 'Ofis kirası',
  tutar: 100,
  odemeYontemi: 'NAKIT' as const
}

function main(): void {
  const dbUrl = process.env.DATABASE_URL
  if (isRailwayDb(dbUrl)) {
    record(
      'production-db-guard',
      true,
      'DATABASE_URL Railway — migrate/API yazma atlandı (yalnız şema kuralları)'
    )
  } else {
    record('production-db-guard', true, 'DATABASE_URL Railway değil')
  }

  const withoutMuvekkil = createOfisKasaHareketiBodySchema.safeParse(baseGelir)
  record('schema-gelir-muvekkilsiz', withoutMuvekkil.success)

  const withMuvekkil = createOfisKasaHareketiBodySchema.safeParse({
    ...baseGelir,
    muvekkilId: '11111111-1111-4111-8111-111111111111'
  })
  record('schema-gelir-muvekkilli', withMuvekkil.success)

  const giderWithMuvekkil = createOfisKasaHareketiBodySchema.safeParse({
    ...baseGider,
    muvekkilId: '11111111-1111-4111-8111-111111111111'
  })
  record(
    'schema-gider-muvekkil-red',
    !giderWithMuvekkil.success &&
      (giderWithMuvekkil.error?.issues.some((i) => i.path.includes('muvekkilId')) ?? false),
    giderWithMuvekkil.success ? 'beklenmeyen kabul' : undefined
  )

  const giderClean = createOfisKasaHareketiBodySchema.safeParse(baseGider)
  record('schema-gider-muvekkilsiz', giderClean.success)

  const nullMuvekkil = createOfisKasaHareketiBodySchema.safeParse({
    ...baseGelir,
    muvekkilId: null
  })
  record('schema-gelir-muvekkil-null', nullMuvekkil.success)

  const failed = results.filter((r) => !r.ok)
  if (failed.length) {
    console.error(`\n${failed.length} kontrol başarısız.`)
    process.exit(1)
  }
  console.info(`\n${results.length} kontrol geçti.`)
}

main()
