import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ParaBirimi, Prisma } from '@prisma/client'
import { formatFixed2AsTrDigits, formatMoneyDisplay, MONEY_NBSP } from './paraBirimi.js'

describe('formatMoneyDisplay', () => {
  it('TRY Decimal without Number conversion for grouping', () => {
    const d = new Prisma.Decimal('5000.00')
    assert.equal(formatMoneyDisplay(d, ParaBirimi.TRY), `5.000,00${MONEY_NBSP}₺`)
  })

  it('TRY negatif / sıfır', () => {
    assert.equal(formatMoneyDisplay('-2500.00', ParaBirimi.TRY), `-2.500,00${MONEY_NBSP}₺`)
    assert.equal(formatMoneyDisplay('0.00', ParaBirimi.TRY), `0,00${MONEY_NBSP}₺`)
  })

  it('USD / EUR prefix', () => {
    assert.equal(formatMoneyDisplay('1000.00', ParaBirimi.USD), '$1.000,00')
    assert.equal(formatMoneyDisplay('-1000.00', ParaBirimi.USD), '-$1.000,00')
    assert.equal(formatMoneyDisplay('1000.00', ParaBirimi.EUR), '€1.000,00')
    assert.equal(formatMoneyDisplay('-1000.00', ParaBirimi.EUR), '-€1.000,00')
  })

  it('fixed2 digits helper', () => {
    assert.equal(formatFixed2AsTrDigits('121076.25'), '121.076,25')
    assert.equal(formatFixed2AsTrDigits('3500.00'), '3.500,00')
  })
})
