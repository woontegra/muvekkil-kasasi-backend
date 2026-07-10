import assert from 'node:assert/strict'
import { siniflaTaksitUyari } from '../src/dashboard/taksitUyari.service.js'

function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day, 12, 0, 0)
}

const bugun = '2026-06-16'

assert.equal(siniflaTaksitUyari(d(2026, 6, 10), 100, bugun), 'vadesiGecmis')
assert.equal(siniflaTaksitUyari(d(2026, 6, 16), 50, bugun), 'bugunOdenecek')
assert.equal(siniflaTaksitUyari(d(2026, 7, 1), 200, bugun), 'odenmemis')
assert.equal(siniflaTaksitUyari(d(2026, 6, 10), 0, bugun), null)
assert.equal(siniflaTaksitUyari(d(2026, 6, 10), 0.0005, bugun), null)

// Kısmi ödenmiş — kalan > 0 sayılır
assert.equal(siniflaTaksitUyari(d(2026, 6, 1), 25.5, bugun), 'vadesiGecmis')

console.log('taksitUyari.service classification tests OK')
