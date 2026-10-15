import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { Request } from 'express'

type Row = Record<string, unknown>
const kasaRows: Row[] = []
const auditRows: Row[] = []

const tx = {
  kasaHareketi: {
    findFirst: async () => null,
    create: async ({ data }: { data: Row }) => {
      const now = new Date('2026-10-15T09:00:00.000Z')
      const row = {
        id: `kh-${kasaRows.length + 1}`,
        onaylayanId: null,
        onayTarihi: null,
        redSebebi: null,
        orijinalHareketId: null,
        otomatikOnayMi: false,
        updatedById: null,
        deletedAt: null,
        deletedById: null,
        deleteReason: null,
        createdAt: now,
        updatedAt: now,
        ...data
      }
      kasaRows.push(row)
      return row
    }
  }
}

;(globalThis as unknown as { prisma: unknown }).prisma = {
  dosya: { findFirst: async () => ({ id: 'd1', tenantId: 't1', muvekkilId: 'm1', aktifMi: true }) },
  tenantFinansKalemi: {
    findFirst: async () => ({ id: '11111111-1111-4111-8111-111111111111', tur: 'GIDER', ad: 'Harç', aktif: true, sistemMi: false })
  },
  $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  auditLog: { create: async ({ data }: { data: Row }) => auditRows.push(data) }
}

const { createKasaHareketiBodySchema } = await import('./kasa.schemas.js')
const { createKasaHareketi, serializeKasaHareketi } = await import('./kasa.service.js')
const { createVekaletTaksitOdemeBodySchema, updateVekaletTaksitOdemeBodySchema } = await import(
  '../vekalet/vekalet.schemas.js'
)

const masrafBody = (odemeYontemi: string) => ({
  tip: 'MASRAF',
  tarih: '2026-10-15',
  tutar: 250,
  odemeYontemi,
  kalemId: '11111111-1111-4111-8111-111111111111',
  masrafiYapanKisi: 'Av. Test'
})

describe('Masraf girişi — Barokart', () => {
  it('masraf sözleşmesi BAROKART kabul eder; eski yöntemler aynen geçerli', () => {
    assert.equal(createKasaHareketiBodySchema.parse(masrafBody('BAROKART')).odemeYontemi, 'BAROKART')
    for (const y of ['NAKIT', 'BANKA', 'KREDI_KARTI', 'DIGER']) {
      assert.equal(createKasaHareketiBodySchema.parse(masrafBody(y)).odemeYontemi, y)
    }
    assert.equal(createKasaHareketiBodySchema.safeParse(masrafBody('POS')).success, false)
  })

  it('kaydedilen masraf BAROKART olarak saklanır ve geri okunduğunda aynı döner', async () => {
    const body = createKasaHareketiBodySchema.parse(masrafBody('BAROKART'))
    const req = { headers: {}, ip: '127.0.0.1', socket: {} } as unknown as Request
    const created = await createKasaHareketi('t1', 'u1', 'AVUKAT' as never, 'd1', body, req)
    assert.equal(kasaRows.length, 1)
    assert.equal(kasaRows[0].odemeYontemi, 'BAROKART')
    assert.equal(kasaRows[0].masrafTuru, 'Harç')
    const dto = serializeKasaHareketi({ ...(created as never), orijinalHareket: null })
    assert.equal(dto.odemeYontemi, 'BAROKART')
  })

  it('vekalet tahsilatı sözleşmesi BAROKART kabul etmez (ofis kasası enum’unda yok)', () => {
    const odeme = { tutar: 100, odemeYontemi: 'BAROKART' }
    assert.equal(createVekaletTaksitOdemeBodySchema.safeParse(odeme).success, false)
    assert.equal(updateVekaletTaksitOdemeBodySchema.safeParse({ odemeYontemi: 'BAROKART' }).success, false)
    assert.equal(createVekaletTaksitOdemeBodySchema.safeParse({ ...odeme, odemeYontemi: 'NAKIT' }).success, true)
  })

  it('Prisma şeması ve migration BAROKART için tutarlı', () => {
    const root = join(process.cwd(), 'prisma')
    const schema = readFileSync(join(root, 'schema.prisma'), 'utf8')
    const enumBlock = /enum OdemeYontemi \{([^}]*)\}/.exec(schema)?.[1] ?? ''
    assert.match(enumBlock, /\bBAROKART\b/)
    const ofisBlock = /enum OfisKasaOdemeYontemi \{([^}]*)\}/.exec(schema)?.[1] ?? ''
    assert.doesNotMatch(ofisBlock, /BAROKART/)
    const migrations = readdirSync(join(root, 'migrations')).filter((d) => d.includes('barokart'))
    assert.equal(migrations.length, 1)
    const sql = readFileSync(join(root, 'migrations', migrations[0], 'migration.sql'), 'utf8')
    assert.match(sql, /ALTER TYPE "OdemeYontemi" ADD VALUE IF NOT EXISTS 'BAROKART'/)
  })
})
