import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Prisma } from '@prisma/client'
import { siniflaTaksitUyari, sumAktifOdemeForUyari } from './taksitUyari.service.js'
import { computeTaksitOdemeOzeti } from '../vekalet/taksitOdemeOzet.js'

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

describe('taksitUyari aktif ödeme', () => {
  it('aktif ödeme odenen tutara girer', () => {
    const rows = [odeme({ id: 'a', tutar: '100.00', ofisKasaHareketId: 'h1' })]
    assert.equal(sumAktifOdemeForUyari(rows).toFixed(2), '100.00')
  })

  it('iptalAt dolu ödeme girmez', () => {
    const rows = [
      odeme({ id: 'a', tutar: '100.00', iptalAt: new Date('2026-01-01'), ofisKasaHareketId: 'h1' })
    ]
    assert.equal(sumAktifOdemeForUyari(rows).toFixed(2), '0.00')
  })

  it('ofis soft-delete ödeme girmez', () => {
    const rows = [
      odeme({
        id: 'a',
        tutar: '100.00',
        ofisKasaHareketId: 'h1',
        ofisDeletedAt: new Date('2026-01-01')
      })
    ]
    assert.equal(sumAktifOdemeForUyari(rows).toFixed(2), '0.00')
  })

  it('bir aktif bir iptal → yalnız aktif', () => {
    const rows = [
      odeme({ id: 'a', tutar: '40.00', ofisKasaHareketId: 'h1' }),
      odeme({
        id: 'b',
        tutar: '60.00',
        iptalAt: new Date('2026-01-01'),
        ofisKasaHareketId: 'h2'
      })
    ]
    assert.equal(sumAktifOdemeForUyari(rows).toFixed(2), '40.00')
  })

  it('tam ödeme iptal → taksit yeniden gecikmiş', () => {
    const vade = new Date(2020, 0, 1)
    const odemeler = [
      odeme({
        id: 'a',
        tutar: '500.00',
        iptalAt: new Date('2026-01-01'),
        ofisKasaHareketId: 'h1'
      })
    ]
    const ozet = computeTaksitOdemeOzeti(D('500.00'), odemeler)
    assert.equal(ozet.kalanTutar.toFixed(2), '500.00')
    assert.equal(siniflaTaksitUyari(vade, ozet.kalanTutar, '2026-09-16'), 'vadesiGecmis')
  })
})
