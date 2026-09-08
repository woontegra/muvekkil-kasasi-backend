/**
 * Sessiz saat ayarı: randevu hatırlatmasını randevu SONRASINA itmez;
 * sessiz dilime denk gelirse önceki uygun (aktif pencere) ana çeker.
 */
import { addDaysYmd, minutesNowTr, planAtFromYmdAndMinutes, ymdTr } from './time.js'
import { isDkAktifPencerede } from './sendWindow.js'

/**
 * idealAt = randevu − offset. Sessiz saatteyse önceki aktif pencerenin son dakikasına alır.
 * Randevu anına veya sonrasına düşerse null (iş planlanmaz).
 */
export function adjustRandevuPlanForQuietHours(
  idealAt: Date,
  randevuBaslangicAt: Date,
  aktifBasDk: number,
  aktifBitDk: number
): Date | null {
  if (!(idealAt instanceof Date) || Number.isNaN(idealAt.getTime())) return null
  if (!(randevuBaslangicAt instanceof Date) || Number.isNaN(randevuBaslangicAt.getTime())) return null
  if (idealAt >= randevuBaslangicAt) return null
  if (!Number.isInteger(aktifBasDk) || !Number.isInteger(aktifBitDk) || aktifBasDk >= aktifBitDk) {
    return idealAt < randevuBaslangicAt ? idealAt : null
  }

  const mins = minutesNowTr(idealAt)
  if (isDkAktifPencerede(mins, aktifBasDk, aktifBitDk)) {
    return idealAt
  }

  // Aktif pencerenin son dakikası (bit hariç → bit - 1)
  const lastActiveDk = Math.max(aktifBasDk, aktifBitDk - 1)
  const ymd = ymdTr(idealAt)

  let candidate: Date
  if (mins >= aktifBitDk) {
    // Gün içinde pencereden sonra → aynı gün pencere sonu
    candidate = planAtFromYmdAndMinutes(ymd, lastActiveDk)
  } else {
    // Pencereden önce (gece / sabah erken) → önceki gün pencere sonu
    candidate = planAtFromYmdAndMinutes(addDaysYmd(ymd, -1), lastActiveDk)
  }

  if (candidate >= randevuBaslangicAt) return null
  if (candidate > idealAt) {
    // Güvenlik: asla idealden sonraya itme
    return null
  }
  return candidate
}
