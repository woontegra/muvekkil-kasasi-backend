import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Prisma } from '@prisma/client'
import { isManuelOfisGelirKaynak } from '../lib/primTahsilatFilter.js'
import {
  emptyDecimalByCurrency,
  moneyStringNonZero,
  netByCurrency,
  sumKarlilikOfisGelirBuckets,
  toMoneyByCurrency
} from './karlilikOfisGelir.js'

const D = (s: string) => new Prisma.Decimal(s)

describe('isManuelOfisGelirKaynak', () => {
  it('null/boş → manuel', () => {
    assert.equal(isManuelOfisGelirKaynak(null), true)
    assert.equal(isManuelOfisGelirKaynak(''), true)
  })

  it('vekalet/icra kaynakları → manuel değil', () => {
    assert.equal(isManuelOfisGelirKaynak('VEKALET_TAHSILATI'), false)
    assert.equal(isManuelOfisGelirKaynak('ICRA_TAHSILAT'), false)
  })
})

describe('sumKarlilikOfisGelirBuckets + netByCurrency', () => {
  it('TRY/USD/EUR karışmaz; DUZELTME bir kez', () => {
    const gelir = sumKarlilikOfisGelirBuckets(
      [
        { tutar: D('1000.00'), paraBirimi: 'TRY' },
        { tutar: D('100.00'), paraBirimi: 'USD' },
        { tutar: D('50.00'), paraBirimi: 'EUR' }
      ],
      [{ tutar: D('-100.00'), paraBirimi: 'TRY' }]
    )
    assert.equal(gelir.TRY.toFixed(2), '900.00')
    assert.equal(gelir.USD.toFixed(2), '100.00')
    assert.equal(gelir.EUR.toFixed(2), '50.00')
  })

  it('yalnız USD gelir → Net USD = gelir', () => {
    const gelir = emptyDecimalByCurrency()
    gelir.USD = D('10000.00')
    const gider = emptyDecimalByCurrency()
    const net = netByCurrency(gelir, gider)
    assert.deepEqual(toMoneyByCurrency(net), {
      TRY: '0.00',
      USD: '10000.00',
      EUR: '0.00'
    })
  })

  it('USD gelir − USD gider; TRY gider USD netten düşmez', () => {
    const gelir = emptyDecimalByCurrency()
    gelir.USD = D('10000.00')
    gelir.TRY = D('500.00')
    const gider = emptyDecimalByCurrency()
    gider.USD = D('2000.00')
    gider.TRY = D('100.00')
    const net = netByCurrency(gelir, gider)
    assert.equal(net.USD.toFixed(2), '8000.00')
    assert.equal(net.TRY.toFixed(2), '400.00')
  })

  it('moneyStringNonZero', () => {
    assert.equal(moneyStringNonZero('0.00'), false)
    assert.equal(moneyStringNonZero('10.00'), true)
  })
})
