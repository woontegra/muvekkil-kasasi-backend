/** Salt okunur — belirli ofis gelir id'sinin Net Kazanç (para birimi) yansıması. */
import { prisma } from '../lib/prisma.js'
import { getMuvekkilKarlilik } from '../dosya/dosyaMaliOzet.service.js'
import { moneyStringNonZero } from '../dosya/karlilikOfisGelir.js'

const TARGET = process.argv[2] ?? 'ca3dd28f'

async function main(): Promise<void> {
  const rows = await prisma.ofisKasaHareketi.findMany({
    where: { id: { startsWith: TARGET } },
    select: {
      id: true,
      tenantId: true,
      kategori: true,
      paraBirimi: true,
      tutar: true,
      onayDurumu: true,
      deletedAt: true,
      tarih: true,
      muvekkilId: true,
      kaynakTipi: true,
      kaynakId: true,
      tenant: { select: { buroAdi: true } }
    }
  })
  const r = rows[0]
  const muvekkilId = r?.muvekkilId
  if (!r || !muvekkilId) {
    console.log(JSON.stringify({ ok: false, rows }, null, 2))
    process.exitCode = 1
    return
  }
  const k = await getMuvekkilKarlilik(r.tenantId, muvekkilId)
  const p = k?.tumZamanlar
  const pb = r.paraBirimi as 'TRY' | 'USD' | 'EUR'
  const tutar = r.tutar.toFixed(2)
  const ofis = p?.ofisGeliri[pb]
  const net = p?.netKazanc[pb]
  console.log(
    JSON.stringify(
      {
        ok:
          Boolean(p) &&
          moneyStringNonZero(ofis) &&
          moneyStringNonZero(net) &&
          Number(ofis) + 1e-9 >= Number(tutar),
        row: {
          id: r.id,
          buroAdi: r.tenant.buroAdi,
          kategori: r.kategori,
          paraBirimi: r.paraBirimi,
          tutar,
          onayDurumu: r.onayDurumu,
          deletedAt: r.deletedAt,
          muvekkilId,
          kaynakTipi: r.kaynakTipi
        },
        karlilik: p
          ? {
              ofisGeliri: p.ofisGeliri,
              netKazanc: p.netKazanc
            }
          : null
      },
      null,
      2
    )
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
