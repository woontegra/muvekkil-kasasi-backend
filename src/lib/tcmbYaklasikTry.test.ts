import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ParaBirimi } from '@prisma/client'
import {
  computeYaklasikTryBatch,
  resolveCaprazHesapFields,
  YAKLASIK_TRY_UNAVAILABLE_MESSAGE
} from './tcmbYaklasikTry.js'

describe('resolveCaprazHesapFields Decimal', () => {
  it('USD debt + TRY payment from mahsup uses rate 48.4305', () => {
    const r = resolveCaprazHesapFields({
      alacakParaBirimi: ParaBirimi.USD,
      odemeParaBirimi: ParaBirimi.TRY,
      mahsupTutari: '2500',
      uygulanacakKur: '48.4305',
      lastEdited: 'mahsup'
    })
    assert.ok(!('error' in r))
    if ('error' in r) return
    assert.equal(r.mahsupTutari, '2500.00')
    assert.equal(r.kasaTutari, '121076.25')
    assert.match(r.onizlemeMetni, /121\.076,25/)
    assert.match(r.onizlemeMetni, /2\.500,00/)
  })

  it('partial $625 → 30.269,06 ₺ (kasa)', () => {
    const r = resolveCaprazHesapFields({
      alacakParaBirimi: 'USD',
      odemeParaBirimi: 'TRY',
      mahsupTutari: 625,
      uygulanacakKur: '48.4305',
      lastEdited: 'mahsup'
    })
    assert.ok(!('error' in r))
    if ('error' in r) return
    assert.equal(r.kasaTutari, '30269.06')
  })

  it('kasa lastEdited back-calcs mahsup', () => {
    const r = resolveCaprazHesapFields({
      alacakParaBirimi: 'USD',
      odemeParaBirimi: 'TRY',
      kasaTutari: '121076.25',
      uygulanacakKur: '48.4305',
      lastEdited: 'kasa'
    })
    assert.ok(!('error' in r))
    if ('error' in r) return
    assert.equal(r.mahsupTutari, '2500.00')
  })

  it('10000 USD × 48.4305 → 484305.00 kasa', () => {
    const r = resolveCaprazHesapFields({
      alacakParaBirimi: 'USD',
      odemeParaBirimi: 'TRY',
      mahsupTutari: '10000',
      uygulanacakKur: '48.4305',
      lastEdited: 'mahsup'
    })
    assert.ok(!('error' in r))
    if ('error' in r) return
    assert.equal(r.kasaTutari, '484305.00')
  })
})

describe('computeYaklasikTryBatch fixture rate path', () => {
  it('TRY para birimi → no approx lines', async () => {
    const r = await computeYaklasikTryBatch({
      paraBirimi: 'TRY',
      items: [{ key: 'a', tutar: '10000' }]
    })
    assert.equal(r.available, false)
    assert.equal(r.items[0]?.yaklasikTry, null)
  })
})
