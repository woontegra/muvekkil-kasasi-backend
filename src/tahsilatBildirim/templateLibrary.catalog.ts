/**
 * Global salt-okunur WhatsApp hazır şablon kataloğu.
 * Tenant DB’ye önceden kopyalanmaz; yalnızca Meta’ya submit + sync ile WhatsAppMetaSablon oluşur.
 */
import type { BildirimKuralTuru } from '@prisma/client'
import type { TemplateVars } from './templates.js'

/** Uygulama değişkeni → Meta named parameter (lowercase + underscore). */
export const APP_VAR_TO_META_PARAM: Record<keyof TemplateVars, string> = {
  muvekkilAdi: 'muvekkil_adi',
  buroAdi: 'buro_adi',
  dosyaBilgisi: 'dosya_bilgisi',
  taksitTutari: 'taksit_tutari',
  odenenTutar: 'odenen_tutar',
  kalanTutar: 'kalan_tutar',
  vadeTarihi: 'vade_tarihi',
  gecikmeGunu: 'gecikme_gunu',
  randevuTarihi: 'randevu_tarihi',
  randevuSaati: 'randevu_saati'
}

export type TemplateLibraryKey =
  | 'TAHSILAT_VADE_ONCESI'
  | 'TAHSILAT_VADE_GUNU'
  | 'TAHSILAT_GECIKMIS'
  | 'TAHSILAT_KISMI_ODEME'
  | 'TAHSILAT_GENEL_HATIRLATMA'
  | 'TAHSILAT_ODEME_ALINDI'
  | 'RANDEVU_HATIRLATMA'

export type TemplateLibraryGroup = 'TAHSILAT' | 'RANDEVU'

export type TemplateLibraryEntry = {
  libraryKey: TemplateLibraryKey
  displayName: string
  shortDescription: string
  suggestedUse: string
  category: 'UTILITY'
  language: 'tr'
  /** Meta template name — WABA içinde deterministik. */
  metaTemplateName: string
  /** Kullanıcıya gösterilen uygulama değişkenli metin. */
  bodyAppText: string
  /** Meta BODY text — positional {{1}}…{{n}} placeholders. */
  bodyMetaText: string
  /** Gönderim/create sırasında değişken sırası (deterministik). */
  variables: Array<keyof TemplateVars>
  exampleValues: Partial<Record<keyof TemplateVars, string>>
  /** Otomasyon kuralı önerisi; null = yalnızca manuel eşleme. */
  suggestedKuralTuru: BildirimKuralTuru | null
  /** UI gruplama */
  templateGroup: TemplateLibraryGroup
  parameterFormat: 'positional'
}

function metaBodyFromApp(appText: string, vars: Array<keyof TemplateVars>): string {
  let out = appText
  vars.forEach((v, idx) => {
    out = out.split(`{${v}}`).join(`{{${idx + 1}}}`)
  })
  return out
}

const SAMPLE: Required<TemplateVars> = {
  muvekkilAdi: 'Ahmet Yılmaz',
  buroAdi: 'Örnek Hukuk Bürosu',
  dosyaBilgisi: 'Vekalet ücreti (2024/12)',
  taksitTutari: '15000.00',
  odenenTutar: '5000.00',
  kalanTutar: '10000.00',
  vadeTarihi: '15.09.2026',
  gecikmeGunu: '3',
  randevuTarihi: '14.08.2026',
  randevuSaati: '15:00'
}

function entry(
  partial: Omit<TemplateLibraryEntry, 'bodyMetaText' | 'category' | 'language' | 'parameterFormat' | 'exampleValues' | 'templateGroup'> & {
    exampleValues?: Partial<Record<keyof TemplateVars, string>>
    templateGroup?: TemplateLibraryGroup
  }
): TemplateLibraryEntry {
  return {
    category: 'UTILITY',
    language: 'tr',
    parameterFormat: 'positional',
    templateGroup: partial.templateGroup ?? 'TAHSILAT',
    bodyMetaText: metaBodyFromApp(partial.bodyAppText, partial.variables),
    exampleValues: Object.fromEntries(
      partial.variables.map((v) => [v, partial.exampleValues?.[v] ?? SAMPLE[v]])
    ) as Partial<Record<keyof TemplateVars, string>>,
    ...partial
  }
}

export const TEMPLATE_LIBRARY: readonly TemplateLibraryEntry[] = [
  entry({
    libraryKey: 'TAHSILAT_VADE_ONCESI',
    displayName: 'Vadeden Önce Hatırlatma',
    shortDescription: 'Vadesi yaklaşan taksit için sade bilgilendirme.',
    suggestedUse: 'Otomatik “vadeden önce” hatırlatmaları',
    metaTemplateName: 'mk_tahsilat_vade_oncesi_v1',
    bodyAppText:
      'Sayın {muvekkilAdi}, {dosyaBilgisi} kapsamındaki {vadeTarihi} vadeli taksidinizden {kalanTutar} TL kalan tutar bulunmaktadır. Bilginize sunarız. Bu mesaj {buroAdi} tarafından gönderilmiştir.',
    variables: ['muvekkilAdi', 'dosyaBilgisi', 'vadeTarihi', 'kalanTutar', 'buroAdi'],
    suggestedKuralTuru: 'VADEDEN_ONCE'
  }),
  entry({
    libraryKey: 'TAHSILAT_VADE_GUNU',
    displayName: 'Vade Günü Hatırlatma',
    shortDescription: 'Vade günü kalan tutar bilgilendirmesi.',
    suggestedUse: 'Otomatik “vade günü” hatırlatmaları',
    metaTemplateName: 'mk_tahsilat_vade_gunu_v1',
    bodyAppText:
      'Sayın {muvekkilAdi}, {dosyaBilgisi} kapsamındaki taksidinizin vade tarihi bugündür. Kalan tutar {kalanTutar} TL’dir. Bilginize sunarız. Bu mesaj {buroAdi} tarafından gönderilmiştir.',
    variables: ['muvekkilAdi', 'dosyaBilgisi', 'kalanTutar', 'buroAdi'],
    suggestedKuralTuru: 'VADE_GUNU'
  }),
  entry({
    libraryKey: 'TAHSILAT_GECIKMIS',
    displayName: 'Gecikmiş Ödeme Hatırlatma',
    shortDescription: 'Vadesi geçmiş taksit için bilgilendirme (tehdit yok).',
    suggestedUse: 'Otomatik “vade sonrası” hatırlatmaları',
    metaTemplateName: 'mk_tahsilat_gecikmis_v1',
    bodyAppText:
      'Sayın {muvekkilAdi}, {dosyaBilgisi} kapsamındaki {vadeTarihi} vadeli taksidiniz için {kalanTutar} TL kalan tutar bulunmaktadır. Ödeme {gecikmeGunu} gündür vadesini geçmiştir. Bilginize sunarız. Bu mesaj {buroAdi} tarafından gönderilmiştir.',
    variables: ['muvekkilAdi', 'dosyaBilgisi', 'vadeTarihi', 'kalanTutar', 'gecikmeGunu', 'buroAdi'],
    suggestedKuralTuru: 'VADE_SONRASI'
  }),
  entry({
    libraryKey: 'TAHSILAT_KISMI_ODEME',
    displayName: 'Kısmi Ödeme Sonrası Kalan Tutar',
    shortDescription: 'Kısmi ödeme sonrası kalan bakiye bilgilendirmesi.',
    suggestedUse: 'Manuel veya ileride kısmi ödeme tetikleri',
    metaTemplateName: 'mk_tahsilat_kismi_odeme_v1',
    bodyAppText:
      'Sayın {muvekkilAdi}, ödemeniz alınmıştır. {dosyaBilgisi} kapsamındaki taksidinizden kalan tutar {kalanTutar} TL’dir. Bilginize sunarız. Bu mesaj {buroAdi} tarafından gönderilmiştir.',
    variables: ['muvekkilAdi', 'dosyaBilgisi', 'kalanTutar', 'buroAdi'],
    suggestedKuralTuru: null
  }),
  entry({
    libraryKey: 'TAHSILAT_GENEL_HATIRLATMA',
    displayName: 'Genel Taksit Hatırlatma',
    shortDescription: 'Genel taksit ve vade bilgilendirmesi.',
    suggestedUse: 'Manuel hatırlatma veya esnek otomasyon',
    metaTemplateName: 'mk_tahsilat_genel_hatirlatma_v1',
    bodyAppText:
      'Sayın {muvekkilAdi}, {dosyaBilgisi} kapsamındaki taksidinizden {kalanTutar} TL kalan tutar bulunmaktadır. Vade tarihi {vadeTarihi}’dir. Bilginize sunarız. Bu mesaj {buroAdi} tarafından gönderilmiştir.',
    variables: ['muvekkilAdi', 'dosyaBilgisi', 'kalanTutar', 'vadeTarihi', 'buroAdi'],
    suggestedKuralTuru: null
  }),
  entry({
    libraryKey: 'TAHSILAT_ODEME_ALINDI',
    displayName: 'Ödeme Alındı Bilgilendirmesi',
    shortDescription: 'Alınan ödeme ve kalan tutar bilgilendirmesi.',
    suggestedUse: 'Ödeme alındı bildirimleri',
    metaTemplateName: 'mk_tahsilat_odeme_alindi_v1',
    bodyAppText:
      'Sayın {muvekkilAdi}, {odenenTutar} TL tutarındaki ödemeniz alınmıştır. {dosyaBilgisi} için kalan tutar {kalanTutar} TL’dir. Bilginize sunarız. Bu mesaj {buroAdi} tarafından gönderilmiştir.',
    variables: ['muvekkilAdi', 'odenenTutar', 'dosyaBilgisi', 'kalanTutar', 'buroAdi'],
    suggestedKuralTuru: null
  }),
  entry({
    libraryKey: 'RANDEVU_HATIRLATMA',
    displayName: 'Randevu Hatırlatma',
    shortDescription: 'Planlanan randevu için bilgilendirme.',
    suggestedUse: 'Randevu otomatik hatırlatmaları',
    metaTemplateName: 'mk_randevu_hatirlatma_v1',
    bodyAppText:
      'Sayın {muvekkilAdi}, {randevuTarihi} tarihinde saat {randevuSaati} için planlanan randevunuzu hatırlatmak isteriz. Bu mesaj {buroAdi} tarafından gönderilmiştir.',
    variables: ['muvekkilAdi', 'randevuTarihi', 'randevuSaati', 'buroAdi'],
    suggestedKuralTuru: null,
    templateGroup: 'RANDEVU'
  })
] as const

export function getLibraryEntry(libraryKey: string): TemplateLibraryEntry | undefined {
  return TEMPLATE_LIBRARY.find((e) => e.libraryKey === libraryKey)
}

export function getLibraryEntryByMetaName(metaName: string): TemplateLibraryEntry | undefined {
  return TEMPLATE_LIBRARY.find((e) => e.metaTemplateName === metaName)
}

export function suggestedLibraryKeyForKural(
  kuralTuru: BildirimKuralTuru
): TemplateLibraryKey | null {
  const hit = TEMPLATE_LIBRARY.find((e) => e.suggestedKuralTuru === kuralTuru)
  return hit?.libraryKey ?? null
}

/** Kullanıcı dostu Meta durum etiketi (teknik enum gösterme). */
export function libraryStatusLabel(statusNormalized: string | null | undefined): {
  code: string
  label: string
} {
  if (!statusNormalized) return { code: 'NOT_CREATED', label: 'Henüz gönderilmedi' }
  const s = statusNormalized.toUpperCase()
  if (s === 'GONDERILIYOR' || s === 'SUBMITTING') {
    return { code: 'SUBMITTING', label: 'Meta’ya gönderiliyor' }
  }
  if (s === 'BEKLIYOR' || s === 'PENDING' || s === 'IN_APPEAL') {
    return { code: 'PENDING', label: 'İnceleniyor' }
  }
  if (s === 'ONAYLANDI' || s === 'APPROVED') {
    return { code: 'APPROVED', label: 'Onaylandı' }
  }
  if (s === 'REDDEDILDI' || s === 'REJECTED') {
    return { code: 'REJECTED', label: 'Reddedildi' }
  }
  if (s === 'DURAKLATILDI' || s === 'PAUSED') {
    return { code: 'PAUSED', label: 'Duraklatıldı' }
  }
  if (s === 'DEVRE_DISI' || s === 'DISABLED' || s === 'DELETED') {
    return { code: 'DISABLED', label: 'Devre dışı' }
  }
  return { code: 'UNKNOWN', label: 'İnceleniyor' }
}
