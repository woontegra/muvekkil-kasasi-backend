import type { BildirimKuralTuru } from '@prisma/client'

export type TemplateVars = {
  muvekkilAdi?: string
  buroAdi?: string
  dosyaBilgisi?: string
  taksitTutari?: string
  odenenTutar?: string
  kalanTutar?: string
  vadeTarihi?: string
  gecikmeGunu?: string
  randevuTarihi?: string
  randevuSaati?: string
}

export const DEFAULT_TEMPLATES: Record<BildirimKuralTuru, string> = {
  VADEDEN_ONCE:
    'Sayın {muvekkilAdi}, {dosyaBilgisi} kapsamında {vadeTarihi} vadeli vekalet ücreti taksidinizden kalan {kalanTutar} tutarı yaklaşıyor (taksit: {taksitTutari}, ödenen: {odenenTutar}). Bilginize sunarız. {buroAdi}',
  VADE_GUNU:
    'Sayın {muvekkilAdi}, {dosyaBilgisi} kapsamında bugün ({vadeTarihi}) vadeli vekalet ücreti taksidinizden kalan {kalanTutar} bulunmaktadır (taksit: {taksitTutari}, ödenen: {odenenTutar}). Bilginize sunarız. {buroAdi}',
  VADE_SONRASI:
    'Sayın {muvekkilAdi}, {dosyaBilgisi} kapsamında {vadeTarihi} vadeli vekalet ücreti taksidinizden kalan {kalanTutar} tutarı {gecikmeGunu} gündür gecikmiştir (taksit: {taksitTutari}, ödenen: {odenenTutar}). Bilginize sunarız. {buroAdi}'
}

const VAR_RE = /\{([a-zA-Z]+)\}/g

export function renderTemplate(
  template: string,
  vars: TemplateVars
): { ok: true; text: string } | { ok: false; missing: string[] } {
  const missing: string[] = []
  const text = template.replace(VAR_RE, (_m, key: string) => {
    const raw = vars[key as keyof TemplateVars]
    if (raw == null || String(raw).trim() === '') {
      missing.push(key)
      return `{${key}}`
    }
    return String(raw)
  })
  if (missing.length > 0) {
    return { ok: false, missing: [...new Set(missing)] }
  }
  return { ok: true, text }
}
