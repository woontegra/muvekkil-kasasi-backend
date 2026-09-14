import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FinansKalemTuru } from '@prisma/client'
import {
  buildTenantFinansKalemSeeds,
  isDigerGelirKalemAd,
  isDigerGiderKalemAd,
  normalizeFinansKalemAd,
  SISTEM_FINANS_KALEMLERI,
  VARSAYILAN_GELIR_KALEMLERI,
  VARSAYILAN_GIDER_KALEMLERI
} from './finansKalemi.defaults.js'

describe('normalizeFinansKalemAd', () => {
  it('collapses case and trim (tr)', () => {
    assert.equal(normalizeFinansKalemAd(' Danışmanlık '), normalizeFinansKalemAd('danışmanlık'))
    assert.equal(normalizeFinansKalemAd('Diğer gelir'), normalizeFinansKalemAd('diğer gelir'))
  })

  it('collapses inner whitespace', () => {
    assert.equal(normalizeFinansKalemAd('Ofis   kirası'), normalizeFinansKalemAd('Ofis kirası'))
  })
})

describe('buildTenantFinansKalemSeeds', () => {
  it('is idempotent in shape and has unique tur+normalizeAd', () => {
    const a = buildTenantFinansKalemSeeds()
    const b = buildTenantFinansKalemSeeds()
    assert.equal(a.length, b.length)
    const keys = new Set(a.map((s) => `${s.tur}:${normalizeFinansKalemAd(s.ad)}`))
    assert.equal(keys.size, a.length)
  })

  it('keeps system codes locked and defaults non-system', () => {
    for (const s of SISTEM_FINANS_KALEMLERI) {
      assert.equal(s.sistemMi, true)
      assert.ok(s.kod)
    }
    const seeds = buildTenantFinansKalemSeeds()
    for (const ad of VARSAYILAN_GELIR_KALEMLERI) {
      const hit = seeds.find((s) => s.tur === FinansKalemTuru.GELIR && s.ad === ad)
      assert.ok(hit)
      assert.equal(hit!.sistemMi, false)
    }
    for (const ad of VARSAYILAN_GIDER_KALEMLERI) {
      const hit = seeds.find((s) => s.tur === FinansKalemTuru.GIDER && s.ad === ad)
      assert.ok(hit)
      assert.equal(hit!.sistemMi, false)
    }
  })

  it('does not put vekalet tahsilatı in manual gelir defaults', () => {
    assert.ok(!VARSAYILAN_GELIR_KALEMLERI.includes('Vekalet Ücreti Tahsilatı'))
  })
})

describe('diger helpers', () => {
  it('detects digger labels', () => {
    assert.equal(isDigerGelirKalemAd('Diğer gelir'), true)
    assert.equal(isDigerGiderKalemAd('Diğer'), true)
    assert.equal(isDigerGiderKalemAd('Diğer gider'), true)
    assert.equal(isDigerGiderKalemAd('Harç'), false)
  })
})
