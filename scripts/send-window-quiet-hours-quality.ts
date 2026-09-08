/**
 * Salt fonksiyon testleri — DB yazmaz, Meta çağırmaz, production’a dokunmaz.
 *
 *   npx tsx scripts/send-window-quiet-hours-quality.ts
 */
import { adjustRandevuPlanForQuietHours } from '../src/tahsilatBildirim/quietHours.js'
import {
  BILDIRIM_ONERI_BASLANGIC_DK,
  BILDIRIM_ONERI_BITIS_DK,
  isGonderimSaatiSecilebilir,
  isIzinliAralikGecerli
} from '../src/tahsilatBildirim/sendWindow.js'
import { minutesNowTr, planAtFromYmdAndMinutes, ymdTr } from '../src/tahsilatBildirim/time.js'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

function fmtTr(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(d)
}

let passed = 0

function check(name: string, fn: () => void): void {
  fn()
  passed += 1
  // eslint-disable-next-line no-console
  console.log(`OK  ${name}`)
}

check('tahsilat sabit saat 00:00 ve 23:55 seçilebilir', () => {
  assert(isGonderimSaatiSecilebilir(0), '00:00')
  assert(isGonderimSaatiSecilebilir(450), '07:30')
  assert(isGonderimSaatiSecilebilir(540), '09:00')
  assert(isGonderimSaatiSecilebilir(1435), '23:55')
  assert(!isGonderimSaatiSecilebilir(1439), '23:59 adım dışı')
  assert(!isGonderimSaatiSecilebilir(601), '10:01 adım dışı')
})

check('aktif aralık önerisi 09:00–20:00 geçerli; gece aralığı da geçerli', () => {
  assert(isIzinliAralikGecerli(BILDIRIM_ONERI_BASLANGIC_DK, BILDIRIM_ONERI_BITIS_DK), 'öneri')
  assert(isIzinliAralikGecerli(0, 1440), 'tam gün')
  assert(isIzinliAralikGecerli(0, 480), '00:00–08:00')
  assert(!isIzinliAralikGecerli(600, 600), 'bas=bit')
  assert(!isIzinliAralikGecerli(1200, 540), 'ters')
})

check('08:30 randevu + 60 dk önce = 07:30 TR (sessiz kapalı → ideal kullanılır)', () => {
  const randevu = new Date('2026-09-10T08:30:00+03:00')
  const ideal = new Date(randevu.getTime() - 60 * 60_000)
  assert(ymdTr(ideal) === '2026-09-10', `ymd=${ymdTr(ideal)}`)
  assert(minutesNowTr(ideal) === 450, `mins=${minutesNowTr(ideal)}`)
  // Sessiz kapalı: planner adjust çağırmadan ideal’i kullanır
  assert(ideal < randevu, 'randevudan önce')
})

check('sessiz açık: 07:30 ideal, pencere 09–20 → önceki gün 19:59', () => {
  const randevu = new Date('2026-09-10T08:30:00+03:00')
  const ideal = new Date(randevu.getTime() - 60 * 60_000)
  const adjusted = adjustRandevuPlanForQuietHours(ideal, randevu, 540, 1200)
  assert(adjusted != null, 'adjusted null olmamalı')
  assert(minutesNowTr(adjusted!) === 19 * 60 + 59, `got ${minutesNowTr(adjusted!)}`)
  assert(ymdTr(adjusted!) === '2026-09-09', `prev day got ${ymdTr(adjusted!)}`)
  assert(adjusted! < randevu, 'randevudan önce')
})

check('gece saati: 22:30 ideal, pencere 09–20 → aynı gün 19:59', () => {
  const randevu = new Date('2026-09-11T08:00:00+03:00')
  const ideal = new Date('2026-09-10T22:30:00+03:00')
  const adjusted = adjustRandevuPlanForQuietHours(ideal, randevu, 540, 1200)
  assert(adjusted != null, 'null')
  assert(ymdTr(adjusted!) === '2026-09-10', ymdTr(adjusted!))
  assert(minutesNowTr(adjusted!) === 19 * 60 + 59, String(minutesNowTr(adjusted!)))
})

check('aktif penceredeki randevu planı değişmez (09:00 ideal, 09–20)', () => {
  const randevu = new Date('2026-09-10T10:00:00+03:00')
  const ideal = new Date('2026-09-10T09:00:00+03:00')
  const adjusted = adjustRandevuPlanForQuietHours(ideal, randevu, 540, 1200)
  assert(adjusted != null && adjusted.getTime() === ideal.getTime(), fmtTr(adjusted ?? new Date(0)))
})

check('tahsilat sabit saat TR plan anı', () => {
  const at = planAtFromYmdAndMinutes('2026-09-10', 450) // 07:30
  assert(minutesNowTr(at) === 450, String(minutesNowTr(at)))
  assert(ymdTr(at) === '2026-09-10', ymdTr(at))
})

check('randevu sonrasıya itilmez: pencere randevudan sonra başlıyorsa ve önceki yoksa null', () => {
  // Randevu 08:00, ideal 07:00; pencere 09–20; önceki gün sonu 19:59 < randevu → OK aslında
  // Daha uç: randevu çok erken ve önceki pencere de randevudan sonra olamaz
  const randevu = new Date('2026-09-10T00:30:00+03:00')
  const ideal = new Date('2026-09-10T00:10:00+03:00')
  // pencere 09–20 → önceki gün 19:59 — randevudan ÖNCE (00:30’dan bir gün önce) → geçerli
  const adjusted = adjustRandevuPlanForQuietHours(ideal, randevu, 540, 1200)
  assert(adjusted != null, 'önceki gün pencere sonu beklenir')
  assert(adjusted! < randevu, 'randevu sonrası olmamalı')
})

// eslint-disable-next-line no-console
console.log(`\n${passed} senaryo geçti.`)
