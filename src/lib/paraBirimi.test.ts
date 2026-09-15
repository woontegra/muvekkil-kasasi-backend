import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ParaBirimi, Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  resolveDovizDonusum,
  resolveParaBirimi,
  resolvePaymentAmounts
} from './paraBirimi.js'

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn()
    assert.fail('Expected AppError')
  } catch (e) {
    assert.ok(e instanceof AppError)
    assert.equal(e.code, code)
  }
}

describe('resolveParaBirimi', () => {
  it('defaults missing to TRY', () => {
    assert.equal(resolveParaBirimi(undefined), ParaBirimi.TRY)
    assert.equal(resolveParaBirimi(''), ParaBirimi.TRY)
  })

  it('accepts valid codes', () => {
    assert.equal(resolveParaBirimi('usd'), ParaBirimi.USD)
    assert.equal(resolveParaBirimi('EUR'), ParaBirimi.EUR)
  })

  it('rejects invalid codes', () => {
    expectAppError(() => resolveParaBirimi('GBP'), 'INVALID_CURRENCY')
  })
})

describe('resolvePaymentAmounts', () => {
  it('same currency: kasa defaults to mahsup', () => {
    const r = resolvePaymentAmounts({
      alacakParaBirimi: ParaBirimi.TRY,
      mahsupTutari: 100,
      kalanBorc: new Prisma.Decimal(500)
    })
    assert.equal(r.isCrossCurrency, false)
    assert.equal(r.mahsupTutari.toFixed(2), '100.00')
    assert.equal(r.kasaTutari.toFixed(2), '100.00')
    assert.equal(r.odemeParaBirimi, ParaBirimi.TRY)
    assert.equal(r.kur, null)
  })

  it('same currency: mismatched kasa rejected', () => {
    expectAppError(
      () =>
        resolvePaymentAmounts({
          alacakParaBirimi: ParaBirimi.TRY,
          mahsupTutari: 100,
          kasaTutari: 99,
          kalanBorc: new Prisma.Decimal(500)
        }),
      'SAME_CURRENCY_AMOUNT_MISMATCH'
    )
  })

  it('cross currency requires kasaTutari and computes kur', () => {
    const r = resolvePaymentAmounts({
      alacakParaBirimi: ParaBirimi.USD,
      odemeParaBirimi: ParaBirimi.TRY,
      mahsupTutari: 100,
      kasaTutari: 3450,
      kalanBorc: new Prisma.Decimal(200)
    })
    assert.equal(r.isCrossCurrency, true)
    assert.equal(r.mahsupTutari.toFixed(2), '100.00')
    assert.equal(r.kasaTutari.toFixed(2), '3450.00')
    assert.equal(r.kur?.toFixed(8), '34.50000000')
    assert.equal(r.kurBazParaBirimi, ParaBirimi.USD)
    assert.equal(r.kurKarsiParaBirimi, ParaBirimi.TRY)
  })

  it('mahsup exceeding remaining debt rejected', () => {
    expectAppError(
      () =>
        resolvePaymentAmounts({
          alacakParaBirimi: ParaBirimi.TRY,
          mahsupTutari: 150,
          kalanBorc: new Prisma.Decimal(100)
        }),
      'MAHSUP_EXCEEDS_REMAINING'
    )
  })

  it('cross currency without kasa rejected', () => {
    expectAppError(
      () =>
        resolvePaymentAmounts({
          alacakParaBirimi: ParaBirimi.EUR,
          odemeParaBirimi: ParaBirimi.TRY,
          mahsupTutari: 50,
          kalanBorc: new Prisma.Decimal(100)
        }),
      'KASA_TUTARI_REQUIRED'
    )
  })
})

describe('resolveDovizDonusum', () => {
  it('computes kur kaynak→hedef', () => {
    const r = resolveDovizDonusum({
      kaynakParaBirimi: ParaBirimi.USD,
      hedefParaBirimi: ParaBirimi.TRY,
      kaynakTutar: 100,
      hedefTutar: 3400
    })
    assert.equal(r.kaynakParaBirimi, ParaBirimi.USD)
    assert.equal(r.hedefParaBirimi, ParaBirimi.TRY)
    assert.equal(r.kur.toFixed(8), '34.00000000')
    assert.match(r.kurOzeti, /1 USD = 34\.00000000 TRY/)
  })

  it('rejects same source and target', () => {
    expectAppError(
      () =>
        resolveDovizDonusum({
          kaynakParaBirimi: ParaBirimi.TRY,
          hedefParaBirimi: ParaBirimi.TRY,
          kaynakTutar: 100,
          hedefTutar: 100
        }),
      'SAME_CURRENCY_CONVERSION'
    )
  })
})
