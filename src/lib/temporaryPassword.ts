import crypto from 'node:crypto'

const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** Okunaklı geçici şifre (harf + rakam, 10–12 karakter). */
export function generateTemporaryPassword(length = 11): string {
  const size = Math.min(12, Math.max(10, length))
  const bytes = crypto.randomBytes(size)
  let out = ''
  for (let i = 0; i < size; i++) {
    out += TEMP_PASSWORD_CHARS[bytes[i]! % TEMP_PASSWORD_CHARS.length]
  }
  return out
}
