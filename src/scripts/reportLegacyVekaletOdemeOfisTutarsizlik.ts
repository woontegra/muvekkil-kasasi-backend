/**
 * Salt okunur — ofis soft-delete + iptalAt null legacy vekalet ödemeleri.
 * Production onarımı YAPMAZ; yalnızca raporlar.
 *
 *   npx tsx src/scripts/reportLegacyVekaletOdemeOfisTutarsizlik.ts
 */
import { prisma } from '../lib/prisma.js'
import { isTahsilatOdemeAktif } from '../lib/tahsilatOdemeAktif.js'

async function main(): Promise<void> {
  const rows = await prisma.vekaletTaksitOdeme.findMany({
    where: {
      iptalAt: null,
      ofisKasaHareketId: { not: null },
      ofisKasaHareket: { deletedAt: { not: null } }
    },
    take: 50,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      tenantId: true,
      taksitId: true,
      tutar: true,
      kasaTutari: true,
      alacakParaBirimi: true,
      odemeParaBirimi: true,
      iptalAt: true,
      ofisKasaHareketId: true,
      createdAt: true,
      ofisKasaHareket: { select: { id: true, deletedAt: true, belgeNo: true, tutar: true } },
      taksit: { select: { taksitNo: true, tutar: true, paraBirimi: true } },
      tenant: { select: { buroAdi: true } }
    }
  })

  const report = rows.map((r) => ({
    odemeId: r.id,
    buroAdi: r.tenant.buroAdi,
    taksitNo: r.taksit.taksitNo,
    mahsup: r.tutar.toFixed(2),
    alacakPb: r.alacakParaBirimi,
    kasa: r.kasaTutari.toFixed(2),
    odemePb: r.odemeParaBirimi,
    ofisBelgeNo: r.ofisKasaHareket?.belgeNo ?? null,
    ofisDeletedAt: r.ofisKasaHareket?.deletedAt?.toISOString() ?? null,
    uiAktif: isTahsilatOdemeAktif(r),
    onarimOnerisi:
      'Tek seferlik onarım (onay sonrası): iptalAt/makbuzDurumu=IPTAL set; ofis ikinci kez silinmez; taksit sync.'
  }))

  console.log(
    JSON.stringify(
      {
        count: report.length,
        note: 'Kullanıcı onayı olmadan production onarımı uygulanmadı.',
        rows: report
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
