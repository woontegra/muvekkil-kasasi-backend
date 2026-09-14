import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Prisma } from '@prisma/client'
import { computeTaksitOdemeOzeti, assertExpectedKalanMatches } from './taksitOdemeOzet.js'
import { AppError } from '../middleware/errorHandler.js'

const D = (s: string) => new Prisma.Decimal(s)

describe('computeTaksitOdemeOzeti', () => {
  it('ödemesiz $2500 → kalan 2500', () => {
    const o = computeTaksitOdemeOzeti(D('2500.00'), [])
    assert.equal(o.odenenToplamStr, '0.00')
    assert.equal(o.kalanTutarStr, '2500.00')
  })

  it('aktif $1032.41 → kalan 1467.59', () => {
    const o = computeTaksitOdemeOzeti(D('2500.00'), [
      {
        id: 'a',
        tutar: D('1032.41'),
        iptalAt: null,
        ofisKasaHareketId: 'h1',
        ofisKasaHareket: { deletedAt: null }
      }
    ])
    assert.equal(o.odenenToplamStr, '1032.41')
    assert.equal(o.kalanTutarStr, '1467.59')
  })

  it('ofis soft-delete → ödeme pasif, kalan yeniden 2500', () => {
    const o = computeTaksitOdemeOzeti(D('2500.00'), [
      {
        id: 'a',
        tutar: D('1032.41'),
        iptalAt: null,
        ofisKasaHareketId: 'h1',
        ofisKasaHareket: { deletedAt: new Date() }
      }
    ])
    assert.equal(o.odenenToplamStr, '0.00')
    assert.equal(o.kalanTutarStr, '2500.00')
  })

  it('iptalAt dolu → pasif', () => {
    const o = computeTaksitOdemeOzeti(D('2500.00'), [
      {
        id: 'a',
        tutar: D('1032.41'),
        iptalAt: new Date(),
        ofisKasaHareketId: null,
        ofisKasaHareket: null
      }
    ])
    assert.equal(o.kalanTutarStr, '2500.00')
  })

  it('STALE_PAYMENT_SUMMARY 409', () => {
    const actual = computeTaksitOdemeOzeti(D('2500.00'), [])
    assert.throws(
      () => assertExpectedKalanMatches(D('1467.59'), actual, 'USD'),
      (e: unknown) => e instanceof AppError && e.code === 'STALE_PAYMENT_SUMMARY' && e.statusCode === 409
    )
  })
})
