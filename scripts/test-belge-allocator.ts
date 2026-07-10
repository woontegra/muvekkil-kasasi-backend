import assert from 'node:assert/strict'
import { createBelgeNoAllocator } from '../src/import/belgeNoAllocator.js'

function testEmptyBelgeGetsUniqueNumbers(): void {
  const reserved = new Set<string>()
  const alloc = createBelgeNoAllocator(reserved, 'abc12345')
  const a = alloc.allocate('', 'OK', 1)
  const b = alloc.allocate(null, 'OK', 2)
  const c = alloc.allocate('   ', 'DK', 3)
  assert.notEqual(a, b)
  assert.notEqual(b, c)
  assert.match(a, /^IMP-abc12345-OK-1$/)
  const warnings = alloc.summaryWarnings()
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /Belge numarası boş olan 3 kayıt/)
  assert.doesNotMatch(JSON.stringify(warnings), /EMPTY/)
}

function testRealBelgeConflict(): void {
  const reserved = new Set<string>(['MK-2024-001'])
  const alloc = createBelgeNoAllocator(reserved, 'batch01')
  const belgeNo = alloc.allocate('MK-2024-001', 'DK', 10)
  assert.notEqual(belgeNo, 'MK-2024-001')
  assert.match(belgeNo, /^IMP-batch01-DK-10-MK-2024-001/)
}

function testPreservedRealBelge(): void {
  const reserved = new Set<string>()
  const alloc = createBelgeNoAllocator(reserved, 'batch01')
  assert.equal(alloc.allocate('MK-UNIQUE-99', 'OK', 5), 'MK-UNIQUE-99')
  assert.equal(alloc.summaryWarnings().length, 0)
}

testEmptyBelgeGetsUniqueNumbers()
testRealBelgeConflict()
testPreservedRealBelge()
console.log('belgeNoAllocator tests OK')
