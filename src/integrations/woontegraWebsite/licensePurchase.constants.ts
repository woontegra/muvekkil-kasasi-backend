/** Woontegra Website checkout ürün / amaç kodları. */
export const LICENSE_PURCHASE_PRODUCT_CODE = 'MUVEKKIL_KASA_SAAS' as const

/** @deprecated Yeni oturumlarda DEMO_CONVERSION kullanılır. */
export const LICENSE_PURCHASE_PURPOSE = 'LICENSE_PURCHASE' as const
export const DEMO_CONVERSION_PURPOSE = 'DEMO_CONVERSION' as const
export const LICENSE_RENEWAL_PURPOSE = 'LICENSE_RENEWAL' as const

/**
 * Terk edilmiş WhatsApp mesaj paketi Website checkout kodları.
 * Yeni oturum oluşturulmaz; eski session resolve/bind/fulfill 410 ile reddedilir.
 * DB kolon `package_id` migration geçmişi korunur.
 */
export const ABANDONED_WHATSAPP_MESAJ_PAKETI_PRODUCT_CODE = 'WHATSAPP_MESAJ_PAKETI' as const
export const ABANDONED_WHATSAPP_MESAJ_PAKETI_PURPOSE = 'WHATSAPP_MESAJ_PAKETI' as const
