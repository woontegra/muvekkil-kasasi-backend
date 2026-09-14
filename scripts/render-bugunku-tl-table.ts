import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeYaklasikTryBatch } from '../src/lib/tcmbYaklasikTry.js'

async function main(): Promise<void> {
  // 10 taksitli örnek: 4×2500 + 6×625 = 10000 USD (tipik plan)
  const rows = [
    ...Array.from({ length: 4 }, (_, i) => ({ key: `t${i + 1}`, tutar: '2500', label: `$2.500,00` })),
    ...Array.from({ length: 6 }, (_, i) => ({ key: `t${i + 5}`, tutar: '625', label: `$625,00` }))
  ]
  const r = await computeYaklasikTryBatch({
    paraBirimi: 'USD',
    items: rows.map((x) => ({ key: x.key, tutar: x.tutar }))
  })
  const byKey = Object.fromEntries(r.items.map((i) => [i.key, i]))
  const bodyRows = rows
    .map((row, idx) => {
      const tl = byKey[row.key]
      return `<tr>
        <td>${idx + 1}</td>
        <td>2026-0${(idx % 9) + 1}-15</td>
        <td class="num">${row.label}</td>
        <td class="tl">${r.available ? tl?.yaklasikTryGosterim ?? '—' : 'Hesaplanamadı'}</td>
        <td class="num">$0,00</td>
        <td class="num">${row.label}</td>
      </tr>`
    })
    .join('\n')

  const html = `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"/>
<title>Bugünkü TL karşılığı — taksit tablosu</title>
<style>
  body{font-family:Segoe UI,system-ui,sans-serif;background:#f8fafc;color:#0f172a;padding:24px}
  h1{font-size:18px;margin:0 0 8px}
  .hint{font-size:12px;color:#334155;margin-bottom:12px;padding:8px 12px;background:#e2e8f0;border-radius:8px}
  table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden}
  th,td{padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px}
  th{background:#f1f5f9;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.02em}
  .num,.tl{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;font-size:13px}
  .tl{color:#0f172a}
</style></head><body>
<h1>Anlaşılan vekalet — 10 taksit (USD)</h1>
<div class="hint">Ekranın açıldığı günün TCMB Döviz Alış kuruna göre hesaplanır.
${r.available ? ` · ${r.kurBilgiSatiri}` : ' · TL karşılığı şu anda hesaplanamadı'}</div>
<table>
<thead><tr>
<th>Taksit no</th><th>Vade tarihi</th><th>Taksit tutarı</th>
<th>Bugünkü TL karşılığı</th><th>Ödenen</th><th>Kalan</th>
</tr></thead>
<tbody>${bodyRows}</tbody>
</table>
</body></html>`
  const out = join(process.cwd(), 'tmp-bugunku-tl-table.html')
  writeFileSync(out, html, 'utf8')
  console.log(JSON.stringify({ out, available: r.available, kur: r.kurBilgiSatiri, sample: r.items.slice(0, 3) }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
