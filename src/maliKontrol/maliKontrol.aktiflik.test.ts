import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Prisma } from '@prisma/client'
import { filterAktifTahsilatOdemeleri } from '../lib/tahsilatOdemeAktif.js'
import { computeTaksitOdemeOzeti } from '../vekalet/taksitOdemeOzet.js'
import { kasaAvansBakiye } from './maliKontrol.service.js'
import { KasaHareketTipi } from '@prisma/client'

const D = (s: string) => new Prisma.Decimal(s)

describe('maliKontrol uyari aktiflik math', () => {
  it('computeTaksitOdemeOzeti iptal ve ofis-deleted ödemeleri kalan hesabından çıkarır', () => {
    const taksitTutari = D('1000.00')
    const odemeler = [
      {
        id: 'aktif',
        tutar: D('400.00'),
        iptalAt: null,
        ofisKasaHareketId: 'h1',
        ofisKasaHareket: { deletedAt: null }
      },
      {
        id: 'iptal',
        tutar: D('200.00'),
        iptalAt: new Date(),
        ofisKasaHareketId: null,
        ofisKasaHareket: null
      },
      {
        id: 'ofis-sil',
        tutar: D('100.00'),
        iptalAt: null,
        ofisKasaHareketId: 'h2',
        ofisKasaHareket: { deletedAt: new Date() }
      }
    ]

    const aktif = filterAktifTahsilatOdemeleri(odemeler)
    assert.deepEqual(
      aktif.map((o) => o.id),
      ['aktif']
    )

    const ozet = computeTaksitOdemeOzeti(taksitTutari, odemeler)
    assert.equal(ozet.odenenToplamStr, '400.00')
    assert.equal(ozet.kalanTutarStr, '600.00')
  })

  it('kasaAvansBakiye Prisma.Decimal ile avans-masraf+duzeltme', () => {
    const bakiye = kasaAvansBakiye([
      { tip: KasaHareketTipi.AVANS_GIRISI, tutar: D('500.00') },
      { tip: KasaHareketTipi.MASRAF, tutar: D('120.50') },
      { tip: KasaHareketTipi.DUZELTME, tutar: D('20.50') }
    ])
    assert.equal(bakiye.toFixed(2), '400.00')
  })
})
