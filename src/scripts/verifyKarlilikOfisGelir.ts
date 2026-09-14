/**
 * Salt okunur — müşteri danışmanlık geliri kaydını değiştirmez.
 * Mevcut ONAYLI + müvekkil bağlı manuel ofis GELIR’in Net Kazanç (USD/TRY/EUR) yansımasını kontrol eder.
 */
import { prisma } from '../lib/prisma.js'
import { getMuvekkilKarlilik } from '../dosya/dosyaMaliOzet.service.js'
import { isManuelOfisGelirKaynak } from '../lib/primTahsilatFilter.js'
import { moneyStringNonZero } from '../dosya/karlilikOfisGelir.js'

async function main(): Promise<void> {
  const sample = await prisma.ofisKasaHareketi.findFirst({
    where: {
      islemTipi: 'GELIR',
      onayDurumu: 'ONAYLI',
      deletedAt: null,
      muvekkilId: { not: null },
      AND: [
        { OR: [{ kaynakTipi: null }, { kaynakTipi: '' }] },
        {
          OR: [
            { kategori: { contains: 'Danışmanlık', mode: 'insensitive' } },
            { kategori: { contains: 'Danismanlik', mode: 'insensitive' } }
          ]
        }
      ]
    },
    orderBy: { tarih: 'desc' },
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

  if (!sample?.muvekkilId) {
    console.log(JSON.stringify({ ok: false, error: 'Uygun danışmanlık geliri bulunamadı' }, null, 2))
    process.exitCode = 1
    return
  }

  const karlilik = await getMuvekkilKarlilik(sample.tenantId, sample.muvekkilId)
  if (!karlilik) {
    console.log(JSON.stringify({ ok: false, error: 'Kârlılık null' }, null, 2))
    process.exitCode = 1
    return
  }

  const p = karlilik.tumZamanlar
  const tutar = sample.tutar.toFixed(2)
  const pb = sample.paraBirimi as 'TRY' | 'USD' | 'EUR'
  const ofisBucket = p.ofisGeliri[pb]
  const netBucket = p.netKazanc[pb]
  const reflected =
    moneyStringNonZero(ofisBucket) &&
    Number(ofisBucket) + 1e-9 >= Number(tutar) &&
    moneyStringNonZero(netBucket)

  const report = {
    ok: reflected && isManuelOfisGelirKaynak(sample.kaynakTipi),
    sample: {
      id: sample.id,
      tenantId: sample.tenantId,
      buroAdi: sample.tenant.buroAdi,
      kategori: sample.kategori,
      paraBirimi: sample.paraBirimi,
      tutar,
      onayDurumu: sample.onayDurumu,
      deletedAt: sample.deletedAt,
      tarih: sample.tarih.toISOString(),
      muvekkilId: sample.muvekkilId,
      kaynakTipi: sample.kaynakTipi,
      kaynakId: sample.kaynakId
    },
    karlilik: {
      ofisGeliri: p.ofisGeliri,
      netKazanc: p.netKazanc,
      ofisForSample: ofisBucket,
      netForSample: netBucket
    },
    note: 'Kayıt değiştirilmedi. Net ve ofis kovaları aynı para biriminde tutulur.'
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
