import crypto from 'node:crypto'

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '0123456789'

function getRandomChar(charset: string): string {
  return charset[crypto.randomInt(0, charset.length)]!
}

function generateBlock(pattern: string): string {
  let block = ''
  for (const char of pattern) {
    if (char === 'L') block += getRandomChar(LETTERS)
    else if (char === 'D') block += getRandomChar(DIGITS)
  }
  return block
}

/** SaaS lisans anahtarı: A12B-128J-14KM-GFR3 (Bilirkişi Hesap formatı ile uyumlu). */
export function generateSaasLicenseKey(): string {
  const block1 = generateBlock('LDDL')
  const block2 = generateBlock('DDDL')
  const block3 = generateBlock('DDLL')
  const block4 = generateBlock('LLDD')
  return `${block1}-${block2}-${block3}-${block4}`
}

const LICENSE_KEY_REGEX =
  /^[A-Z][0-9]{2}[A-Z]-[0-9]{3}[A-Z]-[0-9]{2}[A-Z]{2}-[A-Z]{2}[0-9]{2}$/

export function isValidSaasLicenseKeyFormat(licenseKey: string): boolean {
  return LICENSE_KEY_REGEX.test(normalizeSaasLicenseKey(licenseKey))
}

/** Karşılaştırma için lisans anahtarını normalize eder (boşluk/tire farklarını tolere etmez, büyük harf). */
export function normalizeSaasLicenseKey(raw: string): string {
  return raw.trim().toUpperCase()
}

export function saasLicenseKeysMatch(a: string, b: string): boolean {
  return normalizeSaasLicenseKey(a) === normalizeSaasLicenseKey(b)
}
