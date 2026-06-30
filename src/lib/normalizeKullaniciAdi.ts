/** Türkçe karakterleri ASCII'ye çevirip güvenli kullanıcı adı üretir. */
const TR_CHAR_MAP: Record<string, string> = {
  ı: 'i',
  İ: 'i',
  I: 'i',
  ş: 's',
  Ş: 's',
  ç: 'c',
  Ç: 'c',
  ğ: 'g',
  Ğ: 'g',
  ö: 'o',
  Ö: 'o',
  ü: 'u',
  Ü: 'u'
}

const ALLOWED = /^[a-z0-9._-]+$/

/**
 * Giriş / kayıt için kullanıcı adını normalize eder.
 * Örnek: Balım48 → balim48, Balım Çağlar → balim-caglar
 */
export function normalizeKullaniciAdi(raw: string): string {
  if (!raw?.trim()) return ''

  let s = ''
  for (const ch of raw.trim()) {
    if (TR_CHAR_MAP[ch] !== undefined) {
      s += TR_CHAR_MAP[ch]
      continue
    }
    if (/\s/.test(ch)) {
      s += '-'
      continue
    }
    const lower = ch.toLocaleLowerCase('tr-TR')
    if (TR_CHAR_MAP[lower] !== undefined) {
      s += TR_CHAR_MAP[lower]
      continue
    }
    if (/[a-zA-Z0-9._-]/.test(ch)) {
      s += lower
    }
  }

  s = s.replace(/[-_.]+/g, (m) => m[0] ?? '-')
  s = s.replace(/^[-_.]+|[-_.]+$/g, '')
  return s.slice(0, 64)
}

export function isValidKullaniciAdi(normalized: string): boolean {
  return normalized.length >= 3 && ALLOWED.test(normalized)
}

/** E-posta değilse kullanıcı adını normalize eder. */
export function normalizeLoginIdentifier(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (t.includes('@')) return t.toLowerCase()
  return normalizeKullaniciAdi(t)
}
