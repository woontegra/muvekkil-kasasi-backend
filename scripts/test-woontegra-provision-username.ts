import assert from 'node:assert/strict'
import {
  buildOwnerUsernameCandidate,
  buildOwnerUsernameCandidates,
  buildStableUsernameSuffix,
  resolveOwnerUsernamePrefix,
} from '../src/integrations/woontegraWebsite/woontegraWebsiteOwnerUsername.js'
import { OWNER_EMAIL_ALREADY_EXISTS_MESSAGE } from '../src/integrations/woontegraWebsite/woontegraWebsiteOwnerEmailGuard.js'
import type { WoontegraWebsiteProvisionBody } from '../src/integrations/woontegraWebsite/woontegraWebsiteProvision.schemas.js'

function sampleBody(overrides: Partial<WoontegraWebsiteProvisionBody> = {}): WoontegraWebsiteProvisionBody {
  return {
    externalOrderId: 'WNT-20260701-000009:item-1',
    externalCustomerId: '3c9f0ecc-4e96-4c42-8845-8bfc26c7932d',
    productCode: 'MUVEKKIL_KASA_SAAS',
    customer: {
      name: 'Test User',
      email: 'info@abc.com',
    },
    licenseDays: 365,
    licenseStatus: 'AKTIF',
    ...overrides,
  }
}

function testUniqueUsernameWithSuffix() {
  const body = sampleBody({ customer: { name: 'A', email: 'info@abc.com' } })
  const [first] = buildOwnerUsernameCandidates(body)
  assert.match(first, /^info_3c9f0e$/)
}

function testDifferentCustomersDifferentUsernames() {
  const a = buildOwnerUsernameCandidates(
    sampleBody({
      customer: { name: 'A', email: 'info@abc.com' },
      externalCustomerId: '3c9f0ecc-4e96-4c42-8845-8bfc26c7932d',
    }),
  )[0]
  const b = buildOwnerUsernameCandidates(
    sampleBody({
      customer: { name: 'B', email: 'info@xyz.com' },
      externalCustomerId: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
    }),
  )[0]
  assert.notEqual(a, b)
  assert.match(a, /^info_/)
  assert.match(b, /^info_/)
}

function testOrderFallbackSuffix() {
  const suffix = buildStableUsernameSuffix(null, 'WNT-20260701-000009:item-1', 0)
  assert.equal(suffix, '000009')
  const username = buildOwnerUsernameCandidate('info', suffix)
  assert.equal(username, 'info_000009')
}

function testShortEmailLocalUsesFallbackPrefix() {
  const prefix = resolveOwnerUsernamePrefix('a@abc.com', 'Ali Veli')
  assert.match(prefix, /^ali/)
}

function testThreeDistinctCandidates() {
  const candidates = buildOwnerUsernameCandidates(sampleBody())
  assert.equal(candidates.length, 3)
  assert.equal(new Set(candidates).size, 3)
}

function testOwnerEmailMessage() {
  assert.match(OWNER_EMAIL_ALREADY_EXISTS_MESSAGE, /otomatik bağlama yapılamaz/i)
}

function main() {
  testUniqueUsernameWithSuffix()
  testDifferentCustomersDifferentUsernames()
  testOrderFallbackSuffix()
  testShortEmailLocalUsesFallbackPrefix()
  testThreeDistinctCandidates()
  testOwnerEmailMessage()
  console.log('woontegraWebsiteOwnerUsername tests: OK')
}

main()
