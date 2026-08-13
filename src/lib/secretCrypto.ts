import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

export class SecretCryptoError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message)
    this.name = 'SecretCryptoError'
  }
}

/**
 * AES-256 anahtarı: WHATSAPP_TOKEN_ENCRYPTION_KEY (min 32).
 * Yoksa non-prod’da JWT_SECRET’ten türetir (uyarı).
 * Production’da bağlantı sırasında açık anahtar zorunlu.
 */
export function resolveTokenEncryptionKey(opts?: { requireExplicit?: boolean }): Buffer {
  const explicit = env.WHATSAPP_TOKEN_ENCRYPTION_KEY?.trim()
  if (explicit) {
    if (explicit.length < 32) {
      throw new SecretCryptoError(
        'WHATSAPP_TOKEN_ENCRYPTION_KEY en az 32 karakter olmalıdır.',
        'ENCRYPTION_KEY_TOO_SHORT'
      )
    }
    return createHash('sha256').update(explicit, 'utf8').digest()
  }

  if (opts?.requireExplicit || env.NODE_ENV === 'production') {
    throw new SecretCryptoError(
      'Production’da WHATSAPP_TOKEN_ENCRYPTION_KEY zorunludur.',
      'ENCRYPTION_KEY_REQUIRED'
    )
  }

  console.warn(
    '[secretCrypto] WHATSAPP_TOKEN_ENCRYPTION_KEY yok — JWT_SECRET’ten türetiliyor (yalnızca non-prod).'
  )
  return createHash('sha256').update(`wa-token:${env.JWT_SECRET}`, 'utf8').digest()
}

/** Format: v1:<iv_b64>:<tag_b64>:<cipher_b64> — plaintext asla loglanmaz. */
export function encryptSecret(plaintext: string, key?: Buffer): string {
  const k = key ?? resolveTokenEncryptionKey()
  if (k.length !== KEY_LEN) {
    throw new SecretCryptoError('Geçersiz şifreleme anahtarı uzunluğu.', 'ENCRYPTION_KEY_INVALID')
  }
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, k, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptSecret(payload: string, key?: Buffer): string {
  const k = key ?? resolveTokenEncryptionKey()
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new SecretCryptoError('Şifreli token formatı geçersiz.', 'DECRYPT_FORMAT')
  }
  const iv = Buffer.from(parts[1]!, 'base64')
  const tag = Buffer.from(parts[2]!, 'base64')
  const data = Buffer.from(parts[3]!, 'base64')
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new SecretCryptoError('Şifreli token IV/tag geçersiz.', 'DECRYPT_FORMAT')
  }
  const decipher = createDecipheriv(ALGO, k, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(data), decipher.final()])
  return dec.toString('utf8')
}
