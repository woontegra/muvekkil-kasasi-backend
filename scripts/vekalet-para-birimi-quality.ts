/**
 * Vekalet ücreti para birimi değişim kuralları — production DB’ye yazmaz.
 *
 *   npx tsx --test src/vekalet/vekaletParaBirimi.test.ts
 *   npx tsx scripts/vekalet-para-birimi-quality.ts
 */
import { ParaBirimi } from '@prisma/client'
import { AppError } from '../src/middleware/errorHandler.js'
import {
  assertVekaletParaBirimiDegisimiIzinli,
  classifyVekaletUpsertMode,
  isPersistedVekaletUcreti,
  isVekaletParaBirimiUpdateDegisimi,
  shouldCascadeVekaletTaksitParaBirimi,
  VEKALET_CURRENCY_CHANGE_FORBIDDEN_MESSAGE,
  VEKALET_PLACEHOLDER_INCONSISTENT_MESSAGE
} from '../src/vekalet/vekaletParaBirimi.js'
import { upsertVekaletUcretiBodySchema } from '../src/vekalet/vekalet.schemas.js'

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail })
  console.info(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function expect409(fn: () => void, code: string): boolean {
  try {
    fn()
    return false
  } catch (e) {
    return e instanceof AppError && e.statusCode === 409 && e.code === code
  }
}

function main(): void {
  for (const pb of ['TRY', 'USD', 'EUR'] as const) {
    const parsed = upsertVekaletUcretiBodySchema.safeParse({
      toplamTutar: 10000,
      paraBirimi: pb
    })
    record(`schema-create-${pb}`, parsed.success)
  }

  record(
    'create-path-not-an-update-change',
    !isVekaletParaBirimiUpdateDegisimi({
      mode: 'create',
      mevcut: ParaBirimi.TRY,
      hedef: ParaBirimi.USD
    })
  )

  record(
    'initialize-not-an-update-change',
    !isVekaletParaBirimiUpdateDegisimi({
      mode: 'initialize',
      mevcut: ParaBirimi.TRY,
      hedef: ParaBirimi.USD
    }) &&
      classifyVekaletUpsertMode({
        existing: { id: 'fix-ph', toplamTutar: 0 },
        tahsilatSayisi: 0,
        taksitler: []
      }) === 'initialize'
  )

  record(
    'persisted-id-required',
    isPersistedVekaletUcreti({ id: 'vek' }) && !isPersistedVekaletUcreti(null)
  )

  record(
    'unpaid-try-to-usd-edit',
    (() => {
      try {
        assertVekaletParaBirimiDegisimiIzinli({
          mevcut: ParaBirimi.TRY,
          hedef: ParaBirimi.USD,
          tahsilatSayisi: 0
        })
        return (
          isVekaletParaBirimiUpdateDegisimi({
            mode: 'edit',
            mevcut: ParaBirimi.TRY,
            hedef: ParaBirimi.USD
          }) && shouldCascadeVekaletTaksitParaBirimi(ParaBirimi.TRY, ParaBirimi.USD)
        )
      } catch {
        return false
      }
    })()
  )

  record(
    'direct-or-partial-payment-blocks-409',
    expect409(
      () =>
        assertVekaletParaBirimiDegisimiIzinli({
          mevcut: ParaBirimi.TRY,
          hedef: ParaBirimi.USD,
          tahsilatSayisi: 1
        }),
      'CURRENCY_CHANGE_FORBIDDEN'
    ) && VEKALET_CURRENCY_CHANGE_FORBIDDEN_MESSAGE.includes('tahsilat')
  )

  record(
    'placeholder-inconsistent-blocks-409',
    expect409(
      () =>
        classifyVekaletUpsertMode({
          existing: { id: 'fix-bad', toplamTutar: 0 },
          tahsilatSayisi: 1,
          taksitler: []
        }),
      'VEKALET_PLACEHOLDER_INCONSISTENT'
    ) && VEKALET_PLACEHOLDER_INCONSISTENT_MESSAGE.includes('tutarsız')
  )

  record(
    'same-currency-re-save-ok-even-with-payments',
    (() => {
      try {
        assertVekaletParaBirimiDegisimiIzinli({
          mevcut: ParaBirimi.USD,
          hedef: ParaBirimi.USD,
          tahsilatSayisi: 3
        })
        return true
      } catch {
        return false
      }
    })()
  )

  const failed = results.filter((r) => !r.ok)
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed.`)
    process.exit(1)
  }
  console.info(`\nAll ${results.length} checks passed (no production DB writes).`)
}

main()
