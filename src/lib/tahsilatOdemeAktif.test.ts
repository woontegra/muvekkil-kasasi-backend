import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { filterAktifTahsilatOdemeleri, isTahsilatOdemeAktif } from '../lib/tahsilatOdemeAktif.js'

describe('isTahsilatOdemeAktif', () => {
  it('ofis bağı yoksa aktif', () => {
    assert.equal(isTahsilatOdemeAktif({ ofisKasaHareketId: null }), true)
  })

  it('iptalAt dolu ise pasif', () => {
    assert.equal(
      isTahsilatOdemeAktif({
        iptalAt: new Date(),
        ofisKasaHareketId: null
      }),
      false
    )
  })

  it('ofis soft-delete ise pasif', () => {
    assert.equal(
      isTahsilatOdemeAktif({
        ofisKasaHareketId: 'h1',
        ofisKasaHareket: { deletedAt: new Date() }
      }),
      false
    )
  })

  it('ofis aktifse aktif', () => {
    assert.equal(
      isTahsilatOdemeAktif({
        ofisKasaHareketId: 'h1',
        ofisKasaHareket: { deletedAt: null }
      }),
      true
    )
  })

  it('filter aktifleri ayırır', () => {
    const rows = [
      { id: 'a', ofisKasaHareketId: '1', ofisKasaHareket: { deletedAt: null } },
      { id: 'b', ofisKasaHareketId: '2', ofisKasaHareket: { deletedAt: new Date() } }
    ]
    assert.deepEqual(
      filterAktifTahsilatOdemeleri(rows).map((r) => r.id),
      ['a']
    )
  })
})
