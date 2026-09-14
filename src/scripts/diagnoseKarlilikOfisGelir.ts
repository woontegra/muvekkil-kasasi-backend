/**
 * Salt okunur teşhis — production verisini değiştirmez.
 * Danışmanlık / manuel ofis GELIR vs kârlılık kaynakları.
 */
import { prisma } from '../lib/prisma.js'

async function main(): Promise<void> {
  const rows = await prisma.ofisKasaHareketi.findMany({
    where: {
      islemTipi: 'GELIR',
      OR: [
        { kategori: { contains: 'Danışmanlık', mode: 'insensitive' } },
        { kategori: { contains: 'Danismanlik', mode: 'insensitive' } }
      ]
    },
    orderBy: { tarih: 'desc' },
    take: 25,
    select: {
      id: true,
      tenantId: true,
      islemTipi: true,
      kategori: true,
      ozelKategoriAdi: true,
      paraBirimi: true,
      tutar: true,
      onayDurumu: true,
      deletedAt: true,
      tarih: true,
      muvekkilId: true,
      muvekkilAdiSnapshot: true,
      kaynakTipi: true,
      kaynakId: true,
      belgeNo: true,
      tenant: { select: { buroAdi: true } }
    }
  })

  const summary = rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    buroAdi: r.tenant.buroAdi,
    tip: r.islemTipi,
    kategori: r.kategori,
    ozelKategoriAdi: r.ozelKategoriAdi,
    paraBirimi: r.paraBirimi,
    tutar: r.tutar.toFixed(2),
    onayDurumu: r.onayDurumu,
    deletedAt: r.deletedAt?.toISOString() ?? null,
    tarih: r.tarih.toISOString(),
    muvekkilId: r.muvekkilId,
    muvekkilAdiSnapshot: r.muvekkilAdiSnapshot,
    kaynakTipi: r.kaynakTipi,
    kaynakId: r.kaynakId,
    belgeNo: r.belgeNo,
    karlilikAdayi:
      r.onayDurumu === 'ONAYLI' &&
      r.deletedAt == null &&
      !r.kaynakTipi &&
      Boolean(r.muvekkilId)
  }))

  console.log(
    JSON.stringify(
      {
        count: summary.length,
        note:
          'Kârlılık API (computeForMuvekkil) ofis_kasa_hareketi okumaz; yalnızca vekaletTaksitOdeme + dosya kasaHareketi kullanır.',
        rows: summary
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
