/**
 * Europe/Istanbul dakika aralığı (0–1439).
 * Sabit 10:00–20:00 ürün engeli kaldırıldı; tüm gün seçilebilir.
 * Önerilen varsayılan (yalnızca yeni kayıt / UI placeholder): 09:00–20:00.
 */

/** Öneri: aktif / sessiz-saat aralığı başlangıcı (09:00). */
export const BILDIRIM_ONERI_BASLANGIC_DK = 540
/** Öneri: aktif aralık bitişi hariç (20:00). */
export const BILDIRIM_ONERI_BITIS_DK = 1200

/** Gün başı / gün sonu (dakika). Bitiş hariç pencere için üst sınır 1440. */
export const BILDIRIM_GUN_BASLANGIC_DK = 0
export const BILDIRIM_GUN_BITIS_EXCLUSIVE_DK = 1440

/** Kural saati: 00:00–23:55, 5 dk adım. */
export const BILDIRIM_GONDERIM_MIN_DK = 0
export const BILDIRIM_GONDERIM_MAX_DK = 1435
export const BILDIRIM_SAAT_ADIM_DK = 5

/** @deprecated Eski sabit pencere adı — artık gün başı (0). */
export const BILDIRIM_PENCERE_BASLANGIC_DK = BILDIRIM_GUN_BASLANGIC_DK
/** @deprecated Eski sabit pencere adı — artık gün sonu exclusive (1440). */
export const BILDIRIM_PENCERE_BITIS_DK = BILDIRIM_GUN_BITIS_EXCLUSIVE_DK

export const BILDIRIM_PENCERE_HATA =
  'Gönderim saati Türkiye saatiyle 00:00–23:55 arasında, 5 dakikalık adımlarla seçilmelidir.'

export const BILDIRIM_PENCERE_ARALIK_HATA =
  'Saat aralığı Türkiye saatiyle 00:00–24:00 içinde olmalı ve başlangıç bitişten küçük olmalıdır.'

/** Aktif (sessiz olmayan) saat diliminde mi? [bas, bit) — bit 1440’a kadar. */
export function isDkAktifPencerede(dk: number, basDk: number, bitDk: number): boolean {
  return Number.isInteger(dk) && dk >= basDk && dk < bitDk
}

/** @deprecated Worker sabit penceresi yok; aktif aralık için isDkAktifPencerede kullanın. */
export function isGonderimSaatiPencerede(dk: number): boolean {
  return isDkAktifPencerede(dk, BILDIRIM_GUN_BASLANGIC_DK, BILDIRIM_GUN_BITIS_EXCLUSIVE_DK)
}

/** Kural / UI seçilebilir sabit saat: [00:00, 23:55], 5 dk adım. */
export function isGonderimSaatiSecilebilir(dk: number): boolean {
  return (
    Number.isInteger(dk) &&
    dk >= BILDIRIM_GONDERIM_MIN_DK &&
    dk <= BILDIRIM_GONDERIM_MAX_DK &&
    dk % BILDIRIM_SAAT_ADIM_DK === 0
  )
}

/**
 * Büro “aktif saat” / sessiz saat sınırı: 0 ≤ bas < bit ≤ 1440.
 * Öneri 09:00–20:00; zorunlu değil.
 */
export function isIzinliAralikGecerli(basDk: number, bitDk: number): boolean {
  if (!Number.isInteger(basDk) || !Number.isInteger(bitDk)) return false
  if (basDk < BILDIRIM_GUN_BASLANGIC_DK || bitDk > BILDIRIM_GUN_BITIS_EXCLUSIVE_DK) return false
  if (basDk >= bitDk) return false
  return true
}
