/** Büro adından URL-safe slug; Türkçe karakterler sadeleştirilir. */
const TR_MAP: Record<string, string> = {
  ğ: 'g',
  ü: 'u',
  ş: 's',
  ı: 'i',
  i: 'i',
  ö: 'o',
  ç: 'c',
  İ: 'i',
  I: 'i',
  â: 'a',
  ê: 'e',
  î: 'i',
  ô: 'o',
  û: 'u'
}

export function slugifyBuroAdi(input: string): string {
  let s = input.trim().toLowerCase()
  for (const [k, v] of Object.entries(TR_MAP)) {
    s = s.split(k).join(v)
  }
  s = s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s.slice(0, 80) || 'buro'
}
