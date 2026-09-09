/**
 * WhatsApp paket talebi Havale/EFT ödeme referansı.
 * Format: WA-YYYYMMDD-1234 (UUID kullanıcıya gösterilmez).
 */
import { randomInt } from 'node:crypto'

export function formatWhatsAppPaketTalepPaymentReferenceDate(d: Date = new Date()): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/** Örn. WA-20260909-4821 */
export function generateWhatsAppPaketTalepPaymentReference(now: Date = new Date()): string {
  const datePart = formatWhatsAppPaketTalepPaymentReferenceDate(now)
  const suffix = String(randomInt(1000, 10000))
  return `WA-${datePart}-${suffix}`
}

export const WHATSAPP_PAKET_TALEP_PAYMENT_REF_RE = /^WA-\d{8}-\d{4}$/
