/**
 * Prim tahsilat türü sınıflandırması — senaryo doğrulama (DB gerektirmez).
 * Çalıştır: npx tsx scripts/test-prim-tahsilat-filter.ts
 */

type TahsilatKaynak = 'DOSYA_AVANS' | 'VEKALET' | 'OFIS_GELIR' | 'ICRA'

type Rule = {
  dosyaTahsilatMi: boolean
  vekaletTahsilatMi: boolean
  ofisKasaGelirMi: boolean
  icraTahsilatMi: boolean
}

type Row = {
  id: string
  kaynak: TahsilatKaynak
  tutar: number
  onayDurumu: 'ONAYLI' | 'ONAYSIZ'
}

function kaynakRuleEnabled(rule: Rule, kaynak: TahsilatKaynak): boolean {
  if (kaynak === 'DOSYA_AVANS') return rule.dosyaTahsilatMi
  if (kaynak === 'VEKALET') return rule.vekaletTahsilatMi
  if (kaynak === 'OFIS_GELIR') return rule.ofisKasaGelirMi
  if (kaynak === 'ICRA') return rule.icraTahsilatMi
  return false
}

function primHesabinaDahil(rule: Rule, row: Row): boolean {
  return row.onayDurumu === 'ONAYLI' && kaynakRuleEnabled(rule, row.kaynak)
}

const icraOnlyRule: Rule = {
  dosyaTahsilatMi: false,
  vekaletTahsilatMi: false,
  ofisKasaGelirMi: false,
  icraTahsilatMi: true
}

const rows: Row[] = [
  { id: 'vekalet-1', kaynak: 'VEKALET', tutar: 3000, onayDurumu: 'ONAYLI' },
  { id: 'icra-1', kaynak: 'ICRA', tutar: 10000, onayDurumu: 'ONAYLI' },
  { id: 'icra-2', kaynak: 'ICRA', tutar: 6000, onayDurumu: 'ONAYLI' },
  { id: 'ofis-1', kaynak: 'OFIS_GELIR', tutar: 5000, onayDurumu: 'ONAYLI' }
]

const primDahil = rows.filter((r) => primHesabinaDahil(icraOnlyRule, r))
const toplam = rows.reduce((s, r) => s + r.tutar, 0)
const primToplam = primDahil.reduce((s, r) => s + r.tutar, 0)

const checks = [
  ['toplamTahsilat', toplam === 24000],
  ['primHesabinaGiren', primToplam === 16000],
  ['vekaletPrimeDahilDegil', !primHesabinaDahil(icraOnlyRule, rows[0])],
  ['ofisPrimeDahilDegil', !primHesabinaDahil(icraOnlyRule, rows[3])],
  ['icraPeşinatPrimeDahil', primHesabinaDahil(icraOnlyRule, rows[1])],
  ['icraTaksitPrimeDahil', primHesabinaDahil(icraOnlyRule, rows[2])],
  ['sadecePrimDahilFiltre', rows.filter((r) => primHesabinaDahil(icraOnlyRule, r)).length === 2]
]

function filterList(rows: Row[], includeNonPremium: boolean): Row[] {
  if (includeNonPremium) return rows
  return rows.filter((r) => primHesabinaDahil(icraOnlyRule, r))
}

const defaultList = filterList(rows, false)
const expandedList = filterList(rows, true)

const defaultChecks = [
  ['varsayilanListeAdedi', defaultList.length === 2],
  ['varsayilanListeToplam', defaultList.reduce((s, r) => s + r.tutar, 0) === 16000],
  ['varsayilanVekaletYok', !defaultList.some((r) => r.kaynak === 'VEKALET')],
  ['varsayilanOfisYok', !defaultList.some((r) => r.kaynak === 'OFIS_GELIR')],
  ['genisletilmisListeAdedi', expandedList.length === 4],
  ['genisletilmisTumTurler', expandedList.length === rows.length]
]

let failed = 0
for (const [name, ok] of [...checks, ...defaultChecks]) {
  const status = ok ? 'OK' : 'FAIL'
  console.log(`${status} ${name}`)
  if (!ok) failed++
}

if (failed > 0) {
  console.error(`\n${failed} kontrol başarısız.`)
  process.exit(1)
}

console.log('\nTüm senaryo kontrolleri geçti.')
