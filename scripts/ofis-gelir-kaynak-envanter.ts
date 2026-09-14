/**
 * Salt okunur envanter: kaynakTipi set ama ödeme satırı bulunamayan ofis GELIR kayıtları.
 * Production verisine yazmaz.
 *
 * Kullanım: npx tsx scripts/ofis-gelir-kaynak-envanter.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const rows = await prisma.ofisKasaHareketi.findMany({
    where: {
      islemTipi: 'GELIR',
      deletedAt: null,
      OR: [{ kaynakTipi: { not: null } }, { kaynakId: { not: null } }]
    },
    select: {
      id: true,
      tenantId: true,
      belgeNo: true,
      kaynakTipi: true,
      kaynakId: true,
      tutar: true,
      paraBirimi: true,
      onayDurumu: true,
      tarih: true
    },
    orderBy: { tarih: 'desc' },
    take: 5000
  })

  const orphans: typeof rows = []
  for (const r of rows) {
    const tip = r.kaynakTipi?.trim()
    const kid = r.kaynakId?.trim()
    if (!tip || !kid) {
      orphans.push(r)
      continue
    }
    if (tip === 'VEKALET_TAHSILATI' || tip === 'VEKALET_TAKSIT_ODEME') {
      const odeme =
        (await prisma.vekaletTaksitOdeme.findFirst({
          where: { id: kid, tenantId: r.tenantId },
          select: { id: true, ofisKasaHareketId: true }
        })) ??
        (await prisma.vekaletTaksitOdeme.findFirst({
          where: { tenantId: r.tenantId, ofisKasaHareketId: r.id },
          select: { id: true, ofisKasaHareketId: true }
        }))
      if (!odeme) orphans.push(r)
      continue
    }
    if (tip === 'ICRA_TAHSILAT' || tip === 'ICRA_TAHSILAT_ODEME') {
      const odeme =
        (await prisma.icraTahsilatOdeme.findFirst({
          where: { id: kid, tenantId: r.tenantId },
          select: { id: true, ofisKasaHareketId: true }
        })) ??
        (await prisma.icraTahsilatOdeme.findFirst({
          where: { tenantId: r.tenantId, ofisKasaHareketId: r.id },
          select: { id: true, ofisKasaHareketId: true }
        }))
      if (!odeme) orphans.push(r)
      continue
    }
    orphans.push(r)
  }

  console.log(
    JSON.stringify(
      {
        scanned: rows.length,
        orphanCount: orphans.length,
        orphans: orphans.map((o) => ({
          id: o.id,
          tenantId: o.tenantId,
          belgeNo: o.belgeNo,
          kaynakTipi: o.kaynakTipi,
          kaynakId: o.kaynakId,
          tutar: o.tutar.toFixed(2),
          paraBirimi: o.paraBirimi,
          onayDurumu: o.onayDurumu,
          tarih: o.tarih.toISOString()
        }))
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
