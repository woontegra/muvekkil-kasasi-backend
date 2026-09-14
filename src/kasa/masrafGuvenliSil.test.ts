import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  assertMasrafSilVerificationAllowed,
  clearMasrafSilFailuresForTests,
  clearMasrafSilPasswordFailures,
  isMasrafSilVerificationBlocked,
  MASRAF_SIL_MAX_FAILURES,
  masrafSilAttemptKey,
  recordMasrafSilPasswordFailure
} from './masrafSilRateLimit.js'
import { buildAvansSilindiAuditMessage, buildMasrafSilindiAuditMessage } from './masrafGuvenliSil.service.js'

describe('masrafSilRateLimit', () => {
  beforeEach(() => clearMasrafSilFailuresForTests())

  it('builds stable key from tenant/user/ip', () => {
    assert.equal(masrafSilAttemptKey('t1', 'u1', '1.2.3.4'), 't1:u1:1.2.3.4')
    assert.equal(masrafSilAttemptKey('t1', 'u1', null), 't1:u1:no-ip')
  })

  it('blocks after max failures in window', () => {
    const key = 't:u:ip'
    const t0 = 1_000_000
    for (let i = 0; i < MASRAF_SIL_MAX_FAILURES - 1; i++) {
      assert.equal(recordMasrafSilPasswordFailure(key, t0 + i), false)
      assert.equal(isMasrafSilVerificationBlocked(key, t0 + i), false)
    }
    assert.equal(recordMasrafSilPasswordFailure(key, t0 + 10), true)
    assert.equal(isMasrafSilVerificationBlocked(key, t0 + 10), true)
    assert.throws(() => assertMasrafSilVerificationAllowed(key, t0 + 10))
  })

  it('clears failures after success', () => {
    const key = 't:u:ip'
    recordMasrafSilPasswordFailure(key, 100)
    clearMasrafSilPasswordFailures(key)
    assert.equal(isMasrafSilVerificationBlocked(key, 101), false)
  })
})

describe('buildMasrafSilindiAuditMessage', () => {
  it('formats immutable audit sentence', () => {
    const msg = buildMasrafSilindiAuditMessage({
      actorName: 'Ayşe Yılmaz',
      at: new Date('2026-09-11T12:30:00+03:00'),
      reason: 'Yanlış dosyaya işlendi'
    })
    assert.match(msg, /Masraf, Ayşe Yılmaz tarafından/)
    assert.match(msg, /tarihinde silindi/)
    assert.match(msg, /Neden: Yanlış dosyaya işlendi/)
  })
})

describe('buildAvansSilindiAuditMessage', () => {
  it('formats avans audit sentence', () => {
    const msg = buildAvansSilindiAuditMessage({
      actorName: 'Ayşe Yılmaz',
      at: new Date('2026-09-11T12:30:00+03:00'),
      reason: 'Mükerrer avans'
    })
    assert.match(msg, /Avans, Ayşe Yılmaz tarafından/)
    assert.match(msg, /Neden: Mükerrer avans/)
  })
})
