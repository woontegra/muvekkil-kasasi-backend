import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createOfisKasaHareketiBodySchema } from './ofisKasa.schemas.js'

const kalemId = '22222222-2222-4222-8222-222222222222'

const baseGider = {
  islemTipi: 'GIDER' as const,
  tarih: new Date().toISOString(),
  kalemId,
  tutar: 500,
  odemeYontemi: 'NAKIT' as const
}

describe('createOfisKasaHareketiBodySchema — GIDER para birimi', () => {
  it('TRY/USD/EUR gider kabul eder', () => {
    for (const paraBirimi of ['TRY', 'USD', 'EUR'] as const) {
      const r = createOfisKasaHareketiBodySchema.safeParse({ ...baseGider, paraBirimi })
      assert.equal(r.success, true, paraBirimi)
      if (r.success) assert.equal(r.data.paraBirimi, paraBirimi)
    }
  })

  it('GIDER + muvekkilId reddeder', () => {
    const r = createOfisKasaHareketiBodySchema.safeParse({
      ...baseGider,
      paraBirimi: 'USD',
      muvekkilId: '11111111-1111-4111-8111-111111111111'
    })
    assert.equal(r.success, false)
  })

  it('varsayılan para birimi boş bırakılabilir (sunucu TRY)', () => {
    const r = createOfisKasaHareketiBodySchema.safeParse(baseGider)
    assert.equal(r.success, true)
  })
})
