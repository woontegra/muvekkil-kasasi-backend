/** Europe/Istanbul gönderim penceresi — worker ile aynı: [600, 1200) dakika. */
export const BILDIRIM_PENCERE_BASLANGIC_DK = 600 // 10:00
export const BILDIRIM_PENCERE_BITIS_DK = 1200 // 20:00 (hariç — 20:00’de gönderilmez)

/** Kural saati en geç 19:55 (5 dk adım; cron her 5 dk ile uyumlu). */
export const BILDIRIM_GONDERIM_MAX_DK = 1195 // 19:55
export const BILDIRIM_SAAT_ADIM_DK = 5

export const BILDIRIM_PENCERE_HATA =
  'Gönderim saati Türkiye saatiyle 10:00–19:55 arasında, 5 dakikalık adımlarla seçilmelidir.'

export const BILDIRIM_PENCERE_ARALIK_HATA =
  'İzinli gönderim aralığı Türkiye saatiyle 10:00–20:00 içinde olmalıdır.'

/** Worker gönderim penceresi: 10:00 dahil, 20:00 hariç. */
export function isGonderimSaatiPencerede(dk: number): boolean {
  return Number.isInteger(dk) && dk >= BILDIRIM_PENCERE_BASLANGIC_DK && dk < BILDIRIM_PENCERE_BITIS_DK
}

/**
 * Kural / UI seçilebilir saat: [10:00, 19:55], 5 dk adım.
 * Worker hâlâ [600, 1200) penceresini kullanır; seçim üst sınırı 19:55’tir.
 */
export function isGonderimSaatiSecilebilir(dk: number): boolean {
  return (
    Number.isInteger(dk) &&
    dk >= BILDIRIM_PENCERE_BASLANGIC_DK &&
    dk <= BILDIRIM_GONDERIM_MAX_DK &&
    dk % BILDIRIM_SAAT_ADIM_DK === 0
  )
}

/** Tenant izinli aralık uçları 10:00–20:00 bandında ve bas < bit olmalı. */
export function isIzinliAralikGecerli(basDk: number, bitDk: number): boolean {
  if (!Number.isInteger(basDk) || !Number.isInteger(bitDk)) return false
  if (basDk < BILDIRIM_PENCERE_BASLANGIC_DK || bitDk > BILDIRIM_PENCERE_BITIS_DK) return false
  if (basDk >= bitDk) return false
  return true
}
