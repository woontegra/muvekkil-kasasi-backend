/**
 * Backend createIcraTahsilatBodySchema + resolve sözleşmesi.
 * Çalıştır: npx tsx scripts/icra-tahsilat-schema-quality.ts
 */
import assert from 'node:assert/strict'
import { createIcraTahsilatBodySchema } from '../src/icraTahsilat/icraTahsilat.schemas.ts'

const USER = '11111111-1111-1111-1111-111111111111'
const PERSONEL = '22222222-2222-2222-2222-222222222222'

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

check('PESIN_TAHSIL + personel/user null (“ben”) → şema geçerli', () => {
  const r = createIcraTahsilatBodySchema.safeParse({
    alacakTuru: 'KARSI_TARAF_VEKALET',
    borcluAd: 'Test Borçlu',
    toplamTutar: 10000,
    tahsilatTipi: 'PESIN_TAHSIL',
    taksitSayisi: 0,
    odemeYontemi: 'NAKIT',
    tahsilatiYapanPersonelId: null,
    tahsilatiYapanUserId: null,
    tahsilatTarihi: new Date('2026-09-03T12:00:00.000Z')
  })
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues))
})

check('PESIN_TAHSIL alanları tamamen yok → şema geçerli (actor yeterli)', () => {
  const r = createIcraTahsilatBodySchema.safeParse({
    alacakTuru: 'KARSI_TARAF_VEKALET',
    borcluAd: 'Test Borçlu',
    toplamTutar: 10000,
    tahsilatTipi: 'PESIN_TAHSIL',
    taksitSayisi: 0,
    odemeYontemi: 'NAKIT'
  })
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues))
})

check('PESINAT_TAKSIT + açık personelId → geçerli', () => {
  const r = createIcraTahsilatBodySchema.safeParse({
    alacakTuru: 'KARSI_TARAF_VEKALET',
    borcluAd: 'Test Borçlu',
    toplamTutar: 10000,
    tahsilatTipi: 'PESINAT_TAKSIT',
    pesinatVar: true,
    pesinatTutar: 2500,
    taksitSayisi: 3,
    ilkVadeTarihi: new Date('2026-09-03T12:00:00.000Z'),
    odemeYontemi: 'NAKIT',
    tahsilatiYapanPersonelId: PERSONEL,
    tahsilatTarihi: new Date('2026-09-03T12:00:00.000Z')
  })
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues))
})

check('PESINAT_TAKSIT + personel null (“ben”) → geçerli', () => {
  const r = createIcraTahsilatBodySchema.safeParse({
    alacakTuru: 'KARSI_TARAF_VEKALET',
    borcluAd: 'Test Borçlu',
    toplamTutar: 10000,
    tahsilatTipi: 'PESINAT_TAKSIT',
    pesinatTutar: 2500,
    taksitSayisi: 3,
    ilkVadeTarihi: new Date('2026-09-03T12:00:00.000Z'),
    odemeYontemi: 'NAKIT',
    tahsilatiYapanPersonelId: null
  })
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues))
})

check('SADECE_TAKSIT personel olmadan → geçerli', () => {
  const r = createIcraTahsilatBodySchema.safeParse({
    alacakTuru: 'KARSI_TARAF_VEKALET',
    borcluAd: 'Test Borçlu',
    toplamTutar: 10000,
    tahsilatTipi: 'SADECE_TAKSIT',
    taksitSayisi: 3,
    ilkVadeTarihi: new Date('2026-09-03T12:00:00.000Z'),
    odemeYontemi: 'NAKIT'
  })
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues))
})

check('User.id personel FK gibi kabul edilmemeli — şema UUID kabul eder ama service yalnızca personelId kullanır', () => {
  // Şema hala tahsilatiYapanUserId alanına izin verir; service artık bunu PrimPersonel lookup’a basmaz.
  const r = createIcraTahsilatBodySchema.safeParse({
    alacakTuru: 'KARSI_TARAF_VEKALET',
    borcluAd: 'Test Borçlu',
    toplamTutar: 10000,
    tahsilatTipi: 'PESIN_TAHSIL',
    taksitSayisi: 0,
    odemeYontemi: 'NAKIT',
    tahsilatiYapanUserId: USER
  })
  assert.equal(r.success, true)
})

console.log(`\n${passed} schema checks passed.`)
