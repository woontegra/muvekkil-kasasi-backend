import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Prisma } from '@prisma/client'
import {
  assertVekaletSilFingerprintMatch,
  computeVekaletSilFingerprint
} from './vekaletUcretiGuvenliSil.service.js'

describe('computeVekaletSilFingerprint', () => {
  const updatedAt = new Date('2026-09-14T12:00:00.000Z')

  it('aynı girdiler aynı hash', () => {
    const odemeler = [
      { id: 'b', tutar: new Prisma.Decimal('100.00'), kasaTutari: new Prisma.Decimal('100.00') },
      { id: 'a', tutar: new Prisma.Decimal('50.00'), kasaTutari: new Prisma.Decimal('50.00') }
    ]
    const fp1 = computeVekaletSilFingerprint({ vekaletUpdatedAt: updatedAt, aktifOdemeler: odemeler })
    const fp2 = computeVekaletSilFingerprint({ vekaletUpdatedAt: updatedAt, aktifOdemeler: [...odemeler].reverse() })
    assert.equal(fp1, fp2)
    assert.match(fp1, /^[a-f0-9]{64}$/)
  })

  it('tutar değişince hash değişir', () => {
    const base = [{ id: 'a', tutar: new Prisma.Decimal('1.00'), kasaTutari: new Prisma.Decimal('1.00') }]
    const fp1 = computeVekaletSilFingerprint({ vekaletUpdatedAt: updatedAt, aktifOdemeler: base })
    const fp2 = computeVekaletSilFingerprint({
      vekaletUpdatedAt: updatedAt,
      aktifOdemeler: [{ id: 'a', tutar: new Prisma.Decimal('2.00'), kasaTutari: new Prisma.Decimal('1.00') }]
    })
    assert.notEqual(fp1, fp2)
  })
})

describe('assertVekaletSilFingerprintMatch', () => {
  it('eşleşmeyince STALE_ANALYSIS', () => {
    assert.throws(
      () => assertVekaletSilFingerprintMatch('aaa', 'bbb'),
      (e: unknown) => {
        assert.ok(e && typeof e === 'object' && 'code' in e)
        assert.equal((e as { code?: string }).code, 'STALE_ANALYSIS')
        return true
      }
    )
  })
})
