import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { smmBekleyenWhere } from './smm.service.js'

describe('smmBekleyenWhere', () => {
  it('tenant + iptalAt null + ofis soft-delete OR', () => {
    const w = smmBekleyenWhere('tenant-a')
    assert.equal(w.tenantId, 'tenant-a')
    assert.equal(w.smmKesildiMi, false)
    assert.equal(w.iptalAt, null)
    assert.deepEqual(w.OR, [
      { ofisKasaHareketId: null },
      { ofisKasaHareket: { is: { deletedAt: null } } }
    ])
  })

  it('farklı tenant farklı filtre', () => {
    assert.notEqual(smmBekleyenWhere('t1').tenantId, smmBekleyenWhere('t2').tenantId)
  })
})
