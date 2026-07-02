/**
 * Provision geçici şifre akışı: tek üretim → tek hash → mail ile aynı değer.
 */
import assert from 'node:assert/strict'
import bcrypt from 'bcrypt'
import { generateTemporaryPassword } from '../src/lib/temporaryPassword.js'

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12)
}

async function simulateCreateProvisionPasswordFlow(): Promise<void> {
  const geciciSifre = generateTemporaryPassword()
  const sifreHash = await hashPassword(geciciSifre)
  const mailPassword = geciciSifre
  assert.equal(await bcrypt.compare(mailPassword, sifreHash), true)
}

async function simulateIdempotentOverwriteBug(): Promise<void> {
  const original = generateTemporaryPassword()
  const originalHash = await hashPassword(original)
  const rotated = generateTemporaryPassword()
  const rotatedHash = await hashPassword(rotated)
  assert.equal(await bcrypt.compare(original, rotatedHash), false, 'idempotent rotate breaks mail password')
  assert.equal(await bcrypt.compare(rotated, originalHash), false)
}

async function main(): Promise<void> {
  await simulateCreateProvisionPasswordFlow()
  await simulateIdempotentOverwriteBug()
  console.log('woontegra provision password flow tests: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
