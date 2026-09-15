import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertSafeMessagingTest,
  assertSafeTestDatabase,
  isProductionApiUrl,
  isProductionDatabaseUrl,
  MessagingTestBlockedError,
  TestDatabaseBlockedError
} from './assertSafeTestDatabase.js'

describe('isProductionDatabaseUrl', () => {
  it('flags rlwy / railway hosts and db name railway', () => {
    assert.equal(
      isProductionDatabaseUrl('postgresql://u:p@thomas.proxy.rlwy.net:16694/railway'),
      true
    )
    assert.equal(
      isProductionDatabaseUrl('postgresql://u:p@xxx.railway.app:5432/app'),
      true
    )
    assert.equal(isProductionDatabaseUrl('postgresql://u:p@localhost:5432/railway'), true)
    assert.equal(isProductionDatabaseUrl('postgresql://u:p@127.0.0.1:5432/muvekkil_test'), false)
  })
})

describe('isProductionApiUrl', () => {
  it('flags railway and prod frontend hosts', () => {
    assert.equal(
      isProductionApiUrl('https://muvekkil-kasasi-backend-production.up.railway.app'),
      true
    )
    assert.equal(isProductionApiUrl('https://muvekkil.woontegra.com'), true)
    assert.equal(isProductionApiUrl('http://localhost:4100'), false)
  })
})

describe('assertSafeTestDatabase', () => {
  const prev = { ...process.env }

  function restore(): void {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k]
    }
    Object.assign(process.env, prev)
  }

  it('blocks when TEST_DATABASE_URL missing (NODE_ENV=test yetmez)', () => {
    delete process.env.TEST_DATABASE_URL
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/muvekkil_test'
    assert.throws(() => assertSafeTestDatabase(), (e: unknown) => {
      assert.ok(e instanceof TestDatabaseBlockedError)
      assert.match(e.message, /BLOCKED: isolated TEST_DATABASE_URL required/)
      return true
    })
    restore()
  })

  it('blocks production TEST_DATABASE_URL', () => {
    process.env.TEST_DATABASE_URL = 'postgresql://u:p@thomas.proxy.rlwy.net:16694/railway'
    assert.throws(() => assertSafeTestDatabase(), TestDatabaseBlockedError)
    restore()
  })

  it('blocks when DATABASE_URL is production even if TEST is local', () => {
    process.env.TEST_DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/muvekkil_test'
    process.env.DATABASE_URL = 'postgresql://u:p@thomas.proxy.rlwy.net:16694/railway'
    assert.throws(() => assertSafeTestDatabase(), (e: unknown) => {
      assert.ok(e instanceof TestDatabaseBlockedError)
      assert.match(e.message, /DATABASE_URL points to production/)
      return true
    })
    restore()
  })

  it('blocks production API URL', () => {
    process.env.TEST_DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/muvekkil_test'
    delete process.env.DATABASE_URL
    assert.throws(
      () =>
        assertSafeTestDatabase({
          apiUrl: 'https://muvekkil-kasasi-backend-production.up.railway.app'
        }),
      TestDatabaseBlockedError
    )
    restore()
  })

  it('allows isolated local TEST_DATABASE_URL without prod DATABASE_URL', () => {
    process.env.TEST_DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/muvekkil_test'
    delete process.env.DATABASE_URL
    delete process.env.E2E_API_URL
    assert.doesNotThrow(() => assertSafeTestDatabase({ apiUrl: 'http://127.0.0.1:4100' }))
    restore()
  })
})

describe('assertSafeMessagingTest', () => {
  const prev = { ...process.env }

  function restore(): void {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k]
    }
    Object.assign(process.env, prev)
  }

  it('blocks real send without mock or ALLOW_REAL flag', () => {
    delete process.env.MESSAGING_TEST_MODE
    delete process.env.SMS_PROVIDER
    delete process.env.WHATSAPP_PROVIDER
    delete process.env.WHATSAPP_TEST_MODE
    delete process.env.ALLOW_REAL_EXTERNAL_MESSAGING
    assert.throws(() => assertSafeMessagingTest(), MessagingTestBlockedError)
    restore()
  })

  it('allows MESSAGING_TEST_MODE=mock', () => {
    process.env.MESSAGING_TEST_MODE = 'mock'
    delete process.env.ALLOW_REAL_EXTERNAL_MESSAGING
    assert.doesNotThrow(() => assertSafeMessagingTest())
    restore()
  })

  it('allows ALLOW_REAL_EXTERNAL_MESSAGING=YES when flag opted in', () => {
    delete process.env.MESSAGING_TEST_MODE
    delete process.env.SMS_PROVIDER
    process.env.ALLOW_REAL_EXTERNAL_MESSAGING = 'YES'
    assert.doesNotThrow(() => assertSafeMessagingTest({ allowRealWithExplicitFlag: true }))
    restore()
  })
})
