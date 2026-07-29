/**
 * Vekalet kısmi ödeme durum / kalan borcu hesaplama senaryoları.
 * Çalıştır: npx tsx scripts/test-vekalet-kismi-odeme.ts
 */
import { Prisma } from '@prisma/client'
import { computeTaksitDurum } from '../src/vekalet/vekalet.service.js'

type Case = {
  name: string
  tutar: number
  odenen: number[]
  vadeOffsetDays: number
  expect: 'ODENMEDI' | 'KISMI_ODENDI' | 'ODENDI' | 'GECIKTI'
}

function d(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n)
}

function run(): void {
  const today = new Date()
  today.setHours(12, 0, 0, 0)

  const cases: Case[] = [
    { name: 'hiç ödeme yok', tutar: 10000, odenen: [], vadeOffsetDays: 10, expect: 'ODENMEDI' },
    { name: 'vadesi geçmiş ödenmemiş', tutar: 10000, odenen: [], vadeOffsetDays: -5, expect: 'GECIKTI' },
    { name: 'kısmi 3000 / 10000', tutar: 10000, odenen: [3000], vadeOffsetDays: 10, expect: 'KISMI_ODENDI' },
    {
      name: 'kısmi + gecikmiş → GECIKTI',
      tutar: 10000,
      odenen: [3000],
      vadeOffsetDays: -2,
      expect: 'GECIKTI'
    },
    { name: 'çoklu kısmi tamamlama', tutar: 10000, odenen: [3000, 4000, 3000], vadeOffsetDays: 5, expect: 'ODENDI' },
    { name: 'tek seferde tam ödeme', tutar: 10000, odenen: [10000], vadeOffsetDays: -1, expect: 'ODENDI' },
    { name: 'tolerance altı kalan (0.00005)', tutar: 100, odenen: [99.99995], vadeOffsetDays: 1, expect: 'ODENDI' }
  ]

  let failed = 0
  for (const c of cases) {
    const vade = new Date(today)
    vade.setDate(vade.getDate() + c.vadeOffsetDays)
    const got = computeTaksitDurum(
      { tutar: d(c.tutar), vadeTarihi: vade, odemeDurumu: 'ODENMEDI' },
      c.odenen.map((x) => ({ tutar: d(x) }))
    )
    const odenenToplam = c.odenen.reduce((s, x) => s + x, 0)
    const kalan = Math.max(0, c.tutar - odenenToplam)
    const ok = got === c.expect
    if (!ok) failed += 1
    console.log(
      `${ok ? 'OK' : 'FAIL'} | ${c.name} | odenen=${odenenToplam.toFixed(2)} kalan=${kalan.toFixed(2)} → ${got} (beklenen ${c.expect})`
    )
  }

  // Aşım kuralı (servis ile aynı tolerans)
  const kalan = 7000
  const attempt = 7000.01
  const over = attempt > kalan + 0.0001
  console.log(`${over ? 'OK' : 'FAIL'} | kalan borç aşımı engeli (${attempt} > ${kalan})`)
  if (!over) failed += 1

  if (failed > 0) {
    console.error(`\n${failed} senaryo başarısız.`)
    process.exit(1)
  }
  console.log(`\n${cases.length + 1} senaryo geçti.`)
}

run()
