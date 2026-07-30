import { BildirimKanali, BildirimKuralTuru } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { DEFAULT_TEMPLATES, renderTemplate, type TemplateVars } from './templates.js'
import { ymdTr } from './time.js'

export type BuildMessageInput = {
  tenantId: string
  kuralTuru?: BildirimKuralTuru
  muvekkilAdi: string
  buroAdi: string
  dosyaBaslik: string
  dosyaNo?: string | null
  vadeTarihi: Date | string
  taksitTutari: number
  odenenTutar: number
  kalanTutar: number
  /** Override şablon metni (kullanıcı düzenlemesi öncesi varsayılan için null). */
  sablonMetni?: string | null
}

function fmtMoney(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function fmtVadeTr(vade: Date | string): string {
  const ymd = typeof vade === 'string' && /^\d{4}-\d{2}-\d{2}/.test(vade) ? vade.slice(0, 10) : ymdTr(new Date(vade))
  const [y, m, d] = ymd.split('-')
  return `${d}.${m}.${y}`
}

function dosyaBilgisi(konu: string, dosyaNo?: string | null): string {
  return dosyaNo ? `${konu} (${dosyaNo})` : konu
}

function gecikmeGunu(vade: Date | string, kuralTuru: BildirimKuralTuru): string {
  if (kuralTuru !== BildirimKuralTuru.VADE_SONRASI) return '0'
  const vadeYmd = typeof vade === 'string' && /^\d{4}-\d{2}-\d{2}/.test(vade) ? vade.slice(0, 10) : ymdTr(new Date(vade))
  const today = ymdTr(new Date())
  const days = Math.round(
    (new Date(`${today}T12:00:00+03:00`).getTime() - new Date(`${vadeYmd}T12:00:00+03:00`).getTime()) / 86_400_000
  )
  return String(Math.max(1, days))
}

export function buildTemplateVars(input: BuildMessageInput & { kuralTuru: BildirimKuralTuru }): TemplateVars {
  return {
    muvekkilAdi: input.muvekkilAdi,
    buroAdi: input.buroAdi,
    dosyaBilgisi: dosyaBilgisi(input.dosyaBaslik, input.dosyaNo),
    taksitTutari: fmtMoney(input.taksitTutari),
    odenenTutar: fmtMoney(input.odenenTutar),
    kalanTutar: fmtMoney(input.kalanTutar),
    vadeTarihi: fmtVadeTr(input.vadeTarihi),
    gecikmeGunu: gecikmeGunu(input.vadeTarihi, input.kuralTuru)
  }
}

/** Merkezi şablon üretimi — UI bileşenlerinde sabit mesaj yazılmaz. */
export async function buildBildirimMesaji(
  input: BuildMessageInput
): Promise<{ ok: true; text: string; kuralTuru: BildirimKuralTuru } | { ok: false; missing: string[]; kuralTuru: BildirimKuralTuru }> {
  const kuralTuru = input.kuralTuru ?? inferKuralTuru(input.vadeTarihi)
  let metin = input.sablonMetni?.trim() || ''
  if (!metin) {
    const row = await prisma.tahsilatBildirimSablonu.findUnique({
      where: {
        tenantId_kuralTuru_kanal: {
          tenantId: input.tenantId,
          kuralTuru,
          kanal: BildirimKanali.WHATSAPP
        }
      }
    })
    metin = row?.metin ?? DEFAULT_TEMPLATES[kuralTuru]
  }
  const rendered = renderTemplate(metin, buildTemplateVars({ ...input, kuralTuru }))
  if (!rendered.ok) return { ok: false, missing: rendered.missing, kuralTuru }
  return { ok: true, text: rendered.text, kuralTuru }
}

function inferKuralTuru(vade: Date | string): BildirimKuralTuru {
  const vadeYmd = typeof vade === 'string' && /^\d{4}-\d{2}-\d{2}/.test(vade) ? vade.slice(0, 10) : ymdTr(new Date(vade))
  const today = ymdTr(new Date())
  if (vadeYmd < today) return BildirimKuralTuru.VADE_SONRASI
  if (vadeYmd === today) return BildirimKuralTuru.VADE_GUNU
  return BildirimKuralTuru.VADEDEN_ONCE
}

export { DEFAULT_TEMPLATES, renderTemplate }
