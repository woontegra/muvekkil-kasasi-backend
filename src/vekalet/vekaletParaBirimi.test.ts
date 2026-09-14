import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ParaBirimi } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  assertVekaletParaBirimiDegisimiIzinli,
  classifyVekaletUpsertMode,
  isPersistedVekaletUcreti,
  isVekaletParaBirimiUpdateDegisimi,
  shouldCascadeVekaletTaksitParaBirimi,
  VEKALET_CURRENCY_CHANGE_FORBIDDEN_MESSAGE,
  VEKALET_PLACEHOLDER_INCONSISTENT_MESSAGE
} from './vekaletParaBirimi.js'

function expectForbidden(fn: () => unknown): void {
  try {
    fn()
    assert.fail('Expected AppError')
  } catch (e) {
    assert.ok(e instanceof AppError)
    assert.equal(e.statusCode, 409)
    assert.equal(e.code, 'CURRENCY_CHANGE_FORBIDDEN')
    assert.equal(e.message, VEKALET_CURRENCY_CHANGE_FORBIDDEN_MESSAGE)
  }
}

describe('classifyVekaletUpsertMode (fixture)', () => {
  it('create when no row', () => {
    assert.equal(
      classifyVekaletUpsertMode({ existing: null, tahsilatSayisi: 0, taksitler: [] }),
      'create'
    )
  })

  it('initialize: zero total, no payment, no positive taksit — update same id path', () => {
    assert.equal(
      classifyVekaletUpsertMode({
        existing: { id: 'fix-placeholder', toplamTutar: 0 },
        tahsilatSayisi: 0,
        taksitler: []
      }),
      'initialize'
    )
    assert.equal(
      isVekaletParaBirimiUpdateDegisimi({
        mode: 'initialize',
        mevcut: ParaBirimi.TRY,
        hedef: ParaBirimi.USD
      }),
      false
    )
  })

  it('edit when total > 0', () => {
    assert.equal(
      classifyVekaletUpsertMode({
        existing: { id: 'fix-real', toplamTutar: 10000 },
        tahsilatSayisi: 0,
        taksitler: []
      }),
      'edit'
    )
  })

  it('inconsistent zero+payment → 409, not silent initialize', () => {
    try {
      classifyVekaletUpsertMode({
        existing: { id: 'fix-bad', toplamTutar: 0 },
        tahsilatSayisi: 1,
        taksitler: []
      })
      assert.fail('expected AppError')
    } catch (e) {
      assert.ok(e instanceof AppError)
      assert.equal(e.statusCode, 409)
      assert.equal(e.code, 'VEKALET_PLACEHOLDER_INCONSISTENT')
      assert.equal(e.message, VEKALET_PLACEHOLDER_INCONSISTENT_MESSAGE)
    }
  })

  it('inconsistent zero+positive taksit → 409', () => {
    try {
      classifyVekaletUpsertMode({
        existing: { id: 'fix-bad-t', toplamTutar: 0 },
        tahsilatSayisi: 0,
        taksitler: [{ tutar: 1000, odemeDurumu: 'BEKLIYOR' }]
      })
      assert.fail('expected AppError')
    } catch (e) {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, 'VEKALET_PLACEHOLDER_INCONSISTENT')
    }
  })
})

describe('isPersistedVekaletUcreti / create vs update', () => {
  it('create path: not persisted', () => {
    assert.equal(isPersistedVekaletUcreti(null), false)
    assert.equal(isPersistedVekaletUcreti({ id: '' }), false)
  })

  it('persisted id present for initialize/edit updates', () => {
    assert.equal(isPersistedVekaletUcreti({ id: 'vek-1' }), true)
  })
})

describe('assertVekaletParaBirimiDegisimiIzinli', () => {
  it('allows unpaid TRY→USD change on edit', () => {
    assert.doesNotThrow(() =>
      assertVekaletParaBirimiDegisimiIzinli({
        mevcut: ParaBirimi.TRY,
        hedef: ParaBirimi.USD,
        tahsilatSayisi: 0
      })
    )
    assert.equal(
      isVekaletParaBirimiUpdateDegisimi({
        mode: 'edit',
        mevcut: ParaBirimi.TRY,
        hedef: ParaBirimi.USD
      }),
      true
    )
    assert.equal(shouldCascadeVekaletTaksitParaBirimi(ParaBirimi.TRY, ParaBirimi.USD), true)
  })

  it('blocks when tahsilat exists', () => {
    expectForbidden(() =>
      assertVekaletParaBirimiDegisimiIzinli({
        mevcut: ParaBirimi.TRY,
        hedef: ParaBirimi.USD,
        tahsilatSayisi: 1
      })
    )
  })

  it('does not treat initialize PB pick as update change', () => {
    assert.equal(
      isVekaletParaBirimiUpdateDegisimi({
        mode: 'initialize',
        mevcut: ParaBirimi.TRY,
        hedef: ParaBirimi.EUR
      }),
      false
    )
  })
})
