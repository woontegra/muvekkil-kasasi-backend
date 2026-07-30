const TURKISH_DOUBLE_CHARS = new Set(['ç', 'ğ', 'ı', 'ş', 'Ğ', 'İ', 'Ş'])

export type SmsPartsInfo = {
  parts: number
  units: number
  maxLen: number
}

/**
 * Netgsm kurallarına göre tahmini parça hesabı:
 * - TR encoding: tek parça 150 birim
 * - ASCII/GSM: tek parça 155 birim
 * Türkçe karakterler (ç,ğ,ı,ş,Ğ,İ,Ş) 2 birim tüketir.
 */
export function calculateSmsParts(text: string, encoding: 'TR' | 'ASCII' = 'TR'): SmsPartsInfo {
  const singleLimit = encoding === 'TR' ? 150 : 155
  let units = 0
  for (const ch of text) {
    units += TURKISH_DOUBLE_CHARS.has(ch) ? 2 : 1
  }
  const parts = Math.max(1, Math.ceil(units / singleLimit))
  return { parts, units, maxLen: singleLimit }
}
