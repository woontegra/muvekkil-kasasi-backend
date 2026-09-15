import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { OfisKasaOnayDurumu } from '@prisma/client'
import { assertOfisHareketGuncellenebilir } from './vekaletTaksitOdeme.service.js'
import { AppError } from '../middleware/errorHandler.js'

describe('assertOfisHareketGuncellenebilir', () => {
  it('null veya ONAYSIZ ofis güncellemeye izin verir', () => {
    assert.doesNotThrow(() => assertOfisHareketGuncellenebilir(null))
    assert.doesNotThrow(() => assertOfisHareketGuncellenebilir(undefined))
    assert.doesNotThrow(() =>
      assertOfisHareketGuncellenebilir({ onayDurumu: OfisKasaOnayDurumu.ONAYSIZ })
    )
  })

  it('ONAYLI ofis 409 ONAYLI_TAHSILAT_LOCKED fırlatır', () => {
    assert.throws(
      () => assertOfisHareketGuncellenebilir({ onayDurumu: OfisKasaOnayDurumu.ONAYLI }),
      (e: unknown) =>
        e instanceof AppError &&
        e.statusCode === 409 &&
        e.code === 'ONAYLI_TAHSILAT_LOCKED' &&
        e.message ===
          'Onaylanmış tahsilat doğrudan değiştirilemez. Önce mevcut tahsilatı güvenli biçimde silip doğru bilgilerle yeniden kaydedin.'
    )
  })
})
