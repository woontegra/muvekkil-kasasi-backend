/**
 * Salt okunur teşhis — $1032.41 / $2500 taksit tutarsızlığı.
 * Production verisini değiştirmez.
 *
 *   npx tsx src/scripts/diagnoseTaksitOdemeTutarsizlik.ts
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { isTahsilatOdemeAktif } from '../lib/tahsilatOdemeAktif.js'
import { computeTaksitOdemeOzeti } from '../vekalet/taksitOdemeOzet.js'

const TARGET_MAHSUP = new Prisma.Decimal('1032.41')
const TARGET_TAKSIT = new Prisma.Decimal('2500.00')

async function main(): Promise<void> {
  const candidates = await prisma.vekaletTaksiti.findMany({
    where: {
      tutar: TARGET_TAKSIT,
      paraBirimi: 'USD',
      taksitNo: 1
    },
    take: 20,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      tenantId: true,
      dosyaId: true,
      vekaletUcretiId: true,
      taksitNo: true,
      tutar: true,
      paraBirimi: true,
      odemeDurumu: true,
      tenant: { select: { buroAdi: true } },
      dosya: { select: { dosyaNo: true, konuBasligi: true } },
      odemeler: {
        orderBy: [{ odemeTarihi: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          taksitId: true,
          tutar: true,
          kasaTutari: true,
          alacakParaBirimi: true,
          odemeParaBirimi: true,
          kur: true,
          tcmbReferansKur: true,
          tcmbKurTarihi: true,
          kurKaynagi: true,
          iptalAt: true,
          makbuzDurumu: true,
          ofisKasaHareketId: true,
          createdAt: true,
          ofisKasaHareket: {
            select: {
              id: true,
              tutar: true,
              paraBirimi: true,
              deletedAt: true,
              onayDurumu: true,
              kaynakTipi: true,
              kaynakId: true,
              belgeNo: true
            }
          }
        }
      }
    }
  })

  const with1032 = candidates.filter((t) =>
    t.odemeler.some((o) => o.tutar.eq(TARGET_MAHSUP) || o.kasaTutari.eq(new Prisma.Decimal('50000.13')))
  )
  const focus = with1032[0] ?? candidates[0]

  if (!focus) {
    console.log(JSON.stringify({ ok: false, error: 'Uygun taksit bulunamadı', candidateCount: candidates.length }, null, 2))
    return
  }

  const rows = focus.odemeler.map((o) => {
    const aktifUi = isTahsilatOdemeAktif(o)
    const aktifCreatePath = o.iptalAt == null // createVekaletTaksitOdeme sumOdemeler şu an tüm satırları sayar (iptalAt filtresi yok!)
    return {
      odemeId: o.id,
      taksitId: o.taksitId,
      mahsupTutar: o.tutar.toFixed(2),
      alacakParaBirimi: o.alacakParaBirimi,
      kasaTutari: o.kasaTutari.toFixed(2),
      odemeParaBirimi: o.odemeParaBirimi,
      kur: o.kur?.toFixed(8) ?? null,
      tcmbReferansKur: o.tcmbReferansKur?.toFixed(8) ?? null,
      tcmbKurTarihi: o.tcmbKurTarihi?.toISOString() ?? null,
      kurKaynagi: o.kurKaynagi,
      iptalAt: o.iptalAt?.toISOString() ?? null,
      makbuzDurumu: o.makbuzDurumu,
      ofisKasaHareketId: o.ofisKasaHareketId,
      ofisDeletedAt: o.ofisKasaHareket?.deletedAt?.toISOString() ?? null,
      ofisTutar: o.ofisKasaHareket?.tutar.toFixed(2) ?? null,
      ofisParaBirimi: o.ofisKasaHareket?.paraBirimi ?? null,
      ofisBelgeNo: o.ofisKasaHareket?.belgeNo ?? null,
      kaynakTipi: o.ofisKasaHareket?.kaynakTipi ?? null,
      kaynakId: o.ofisKasaHareket?.kaynakId ?? null,
      createdAt: o.createdAt.toISOString(),
      aktif_UI_filterAktifTahsilatOdemeleri: aktifUi,
      aktif_createVekaletTaksitOdeme_sumOdemeler: aktifCreatePath,
      tutarsiz: aktifUi !== aktifCreatePath || (o.ofisKasaHareket?.deletedAt != null && o.iptalAt == null)
    }
  })

  const uiOdenen = rows
    .filter((r) => r.aktif_UI_filterAktifTahsilatOdemeleri)
    .reduce((s, r) => s.plus(r.mahsupTutar), new Prisma.Decimal(0))
  const createOdenenLegacy = rows
    .filter((r) => r.aktif_createVekaletTaksitOdeme_sumOdemeler)
    .reduce((s, r) => s.plus(r.mahsupTutar), new Prisma.Decimal(0))
  const kanonik = computeTaksitOdemeOzeti(focus.tutar, focus.odemeler)

  console.log(
    JSON.stringify(
      {
        note: 'Salt okunur. Kök neden (düzeltme öncesi): UI filterAktif; create sumOdemeler tüm satırlar. Düzeltme sonrası create de computeTaksitOdemeOzeti kullanır.',
        dosya: {
          tenantId: focus.tenantId,
          buroAdi: focus.tenant.buroAdi,
          dosyaId: focus.dosyaId,
          dosyaNo: focus.dosya.dosyaNo,
          konu: focus.dosya.konuBasligi,
          vekaletUcretiId: focus.vekaletUcretiId,
          taksitId: focus.id,
          taksitNo: focus.taksitNo,
          taksitTutar: focus.tutar.toFixed(2),
          paraBirimi: focus.paraBirimi,
          odemeDurumu: focus.odemeDurumu
        },
        odemeler: rows,
        ozetKarsilastirma: {
          ui_odenen: uiOdenen.toFixed(2),
          ui_kalan: Prisma.Decimal.max(0, focus.tutar.minus(uiOdenen)).toFixed(2),
          legacy_createValidator_odenen: createOdenenLegacy.toFixed(2),
          legacy_createValidator_kalan: Prisma.Decimal.max(0, focus.tutar.minus(createOdenenLegacy)).toFixed(2),
          kanonik_odenen: kanonik.odenenToplamStr,
          kanonik_kalan: kanonik.kalanTutarStr
        },
        filterFarki: {
          ui: 'vekalet.service.ts getDosyaVekaletPackage → filterAktifTahsilatOdemeleri',
          legacyCreate: 'vekaletTaksitOdeme.service.ts createVekaletTaksitOdeme → sumOdemeler (TÜM ödemeler)',
          fixedCreate: 'vekaletTaksitOdeme.service.ts → computeTaksitOdemeOzeti (ofis deletedAt dahil aktiflik)'
        }
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
