import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { VEKALET_TAHSILAT_ESMM_BLOCK } from './vekaletTahsilatIptal.service.js'

describe('vekaletTahsilatIptal', () => {
  it('e-SMM engel mesajı sabit', () => {
    assert.match(VEKALET_TAHSILAT_ESMM_BLOCK, /e-SMM/i)
  })
})
