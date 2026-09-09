/**
 * WhatsApp ek mesaj paketleri — fiyat ve adet yalnız buradan.
 * Client fiyat/adet gönderemez; server paket id ile çözer.
 */
import { AppError } from '../middleware/errorHandler.js'

export type WhatsAppMesajPaketi = {
  id: string
  mesajAdedi: number
  label: string
  fiyatTL: number
  aktif: boolean
}

export const WHATSAPP_MESAJ_PAKETLERI: readonly WhatsAppMesajPaketi[] = [
  { id: 'wa_msg_500', mesajAdedi: 500, label: '500 mesaj', fiyatTL: 250, aktif: true },
  { id: 'wa_msg_1000', mesajAdedi: 1000, label: '1.000 mesaj', fiyatTL: 400, aktif: true },
  { id: 'wa_msg_2500', mesajAdedi: 2500, label: '2.500 mesaj', fiyatTL: 750, aktif: true },
  { id: 'wa_msg_5000', mesajAdedi: 5000, label: '5.000 mesaj', fiyatTL: 1250, aktif: true }
] as const

export function listWhatsAppMesajPaketleri(): WhatsAppMesajPaketi[] {
  return WHATSAPP_MESAJ_PAKETLERI.map((p) => ({ ...p }))
}

export function getWhatsAppMesajPaketiById(packageId: string): WhatsAppMesajPaketi | null {
  const id = packageId.trim()
  const hit = WHATSAPP_MESAJ_PAKETLERI.find((p) => p.id === id)
  return hit ? { ...hit } : null
}

export function requireActiveWhatsAppMesajPaketi(packageId: string): WhatsAppMesajPaketi {
  const p = getWhatsAppMesajPaketiById(packageId)
  if (!p) {
    throw new AppError(404, 'Mesaj paketi bulunamadı.', 'WA_PAKET_NOT_FOUND')
  }
  if (!p.aktif) {
    throw new AppError(409, 'Bu mesaj paketi şu an satışta değil.', 'WA_PAKET_INACTIVE')
  }
  return p
}
