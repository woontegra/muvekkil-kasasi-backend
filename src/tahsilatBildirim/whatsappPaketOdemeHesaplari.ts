/**
 * Woontegra WhatsApp mesaj paketi Havale/EFT hesapları (backend referans / mail).
 * Frontend UI aynı içerik için `whatsappPaketOdemeHesaplari.ts` kullanır.
 */
export type WhatsAppPaketOdemeHesabi = {
  id: string
  bankaAdi: string
  hesapSahibi: string
  /** Boşluksuz IBAN (kopyalama / doğrulama). */
  iban: string
}

export const WHATSAPP_PAKET_ODEME_HESAPLARI: readonly WhatsAppPaketOdemeHesabi[] = [
  {
    id: 'isbank',
    bankaAdi: 'Türkiye İş Bankası A.Ş.',
    hesapSahibi: 'Woontegra Teknoloji Yazılım ve Dijital Hizmetler Ltd. Şti.',
    iban: 'TR900006400000136600487451'
  },
  {
    id: 'enpara',
    bankaAdi: 'Enpara Bank A.Ş.',
    hesapSahibi: 'Woontegra Teknoloji Yazılım ve Dijital Hizmetler Ltd. Şti.',
    iban: 'TR710015700000000204988746'
  }
] as const

/** Ekran için 4’lü gruplu IBAN. */
export function formatIbanGrouped(iban: string): string {
  const compact = iban.replace(/\s+/g, '').toUpperCase()
  return compact.replace(/(.{4})/g, '$1 ').trim()
}
