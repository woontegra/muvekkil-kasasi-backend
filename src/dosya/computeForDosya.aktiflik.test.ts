import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Prisma } from '@prisma/client'
import { aktifTahsilatOdemeWhere } from '../lib/tahsilatOdemeAktif.js'
import { sumAktifOdemeTutarForDosyaMali } from './dosyaMaliOzet.service.js'
import { filterAktifTahsilatOdemeleri } from '../lib/tahsilatOdemeAktif.js'

const D = (s: string) => new Prisma.Decimal(s)

function odeme(partial: {
  id: string
  tutar: string
  iptalAt?: Date | null
  ofisKasaHareketId?: string | null
  ofisDeletedAt?: Date | null
}) {
  return {
    id: partial.id,
    tutar: D(partial.tutar),
    iptalAt: partial.iptalAt ?? null,
    ofisKasaHareketId: partial.ofisKasaHareketId ?? null,
    ofisKasaHareket:
      partial.ofisKasaHareketId == null
        ? null
        : { deletedAt: partial.ofisDeletedAt ?? null }
  }
}

describe('computeForDosya aktiflik (dosya mali özet)', () => {
  it('aktif ofis bağlı tahsilat → ödenen tutara girer', () => {
    const rows = [odeme({ id: 'a', tutar: '100.00', ofisKasaHareketId: 'h1' })]
    assert.equal(sumAktifOdemeTutarForDosyaMali(rows).toFixed(2), '100.00')
  })

  it('soft-delete ofis hareketi bağlı tahsilat → girmez', () => {
    const rows = [
      odeme({
        id: 'a',
        tutar: '100.00',
        ofisKasaHareketId: 'h1',
        ofisDeletedAt: new Date('2026-01-01')
      })
    ]
    assert.equal(sumAktifOdemeTutarForDosyaMali(rows).toFixed(2), '0.00')
  })

  it('aktif tahsilat (ofis bağsız) → girer', () => {
    const rows = [odeme({ id: 'a', tutar: '50.00' })]
    assert.equal(sumAktifOdemeTutarForDosyaMali(rows).toFixed(2), '50.00')
  })

  it('iptalAt dolu tahsilat → girmez', () => {
    const rows = [
      odeme({ id: 'a', tutar: '50.00', iptalAt: new Date('2026-01-01'), ofisKasaHareketId: 'h1' })
    ]
    assert.equal(sumAktifOdemeTutarForDosyaMali(rows).toFixed(2), '0.00')
  })

  it('bir aktif bir iptal / soft-delete → yalnız aktif', () => {
    const rows = [
      odeme({ id: 'a', tutar: '40.00', ofisKasaHareketId: 'h1' }),
      odeme({
        id: 'b',
        tutar: '60.00',
        iptalAt: new Date('2026-01-01'),
        ofisKasaHareketId: 'h2'
      }),
      odeme({
        id: 'c',
        tutar: '10.00',
        ofisKasaHareketId: 'h3',
        ofisDeletedAt: new Date('2026-01-02')
      })
    ]
    assert.equal(sumAktifOdemeTutarForDosyaMali(rows).toFixed(2), '40.00')
  })

  it('aktifTahsilatOdemeWhere dosya ve müvekkil ile aynı kural', () => {
    const w = aktifTahsilatOdemeWhere()
    assert.equal(w.iptalAt, null)
    assert.deepEqual(w.OR, [
      { ofisKasaHareketId: null },
      { ofisKasaHareket: { is: { deletedAt: null } } }
    ])
  })

  it('filterAktifTahsilatOdemeleri ile aynı aktiflik sonucu', () => {
    const rows = [
      odeme({ id: 'a', tutar: '100.00', ofisKasaHareketId: 'h1' }),
      odeme({
        id: 'b',
        tutar: '200.00',
        ofisKasaHareketId: 'h2',
        ofisDeletedAt: new Date('2026-01-01')
      })
    ]
    const filtered = filterAktifTahsilatOdemeleri(rows)
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0]!.id, 'a')
    assert.equal(sumAktifOdemeTutarForDosyaMali(rows).toFixed(2), '100.00')
  })

  it('TRY/USD tutarlar Decimal ile toplanır, Number kullanılmaz', () => {
    const rows = [
      odeme({ id: 'a', tutar: '0.10', ofisKasaHareketId: 'h1' }),
      odeme({ id: 'b', tutar: '0.20', ofisKasaHareketId: 'h2' })
    ]
    assert.equal(sumAktifOdemeTutarForDosyaMali(rows).toFixed(2), '0.30')
  })
})
