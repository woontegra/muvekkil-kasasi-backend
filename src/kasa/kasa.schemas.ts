import { KasaHareketTipi, KasaOnayDurumu, OdemeYontemi } from '@prisma/client'
import { z } from 'zod'

/** Masaüstü ile uyumlu masraf türleri listesi. */
export const MASRAF_TURU_VALUES = [
  'Gider avansı',
  'Keşif harcı',
  'Keşif avansı',
  'Mahkeme harcı',
  'Peşin harç',
  'Karar harcı',
  'İstinaf harcı',
  'Temyiz harcı',
  'Ofis içi kırtasiye',
  'Yol masrafı',
  'Yemek masrafı',
  'Baro pulu',
  'Vekalet harcı',
  'İhtarname masrafı',
  'Bilirkişi ücreti',
  'Diğer masraf'
] as const

export type MasrafTuruValue = (typeof MASRAF_TURU_VALUES)[number]

export const masrafTuruSchema = z.enum(MASRAF_TURU_VALUES)

export function isDigerMasraf(s: string): boolean {
  return s === 'Diğer masraf' || s === 'DİĞER'
}

const tutarPositive = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v),
  z.number().finite().positive('Tutar pozitif olmalıdır.')
)

const tutarSigned = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v),
  z.number().finite({ message: 'Geçerli bir tutar girin.' })
)

export const createKasaHareketiBodySchema = z
  .object({
    tip: z.enum([KasaHareketTipi.AVANS_GIRISI, KasaHareketTipi.MASRAF]),
    tarih: z.coerce.date(),
    masrafTuru: z.string().trim().max(120).optional().nullable(),
    ozelMasrafAdi: z.string().trim().max(200).optional().nullable(),
    aciklama: z.string().trim().max(4000).optional().nullable(),
    tutar: tutarPositive,
    /** İsteğe bağlı; dosya kasası formlarında kullanılmıyor. */
    odemeYontemi: z.nativeEnum(OdemeYontemi).optional().nullable(),
    masrafiYapanKisi: z.string().trim().max(200).optional().nullable(),
    /** Yalnızca AVANS_GIRISI — prim hesabı için tahsilatı yapan personel. */
    tahsilatiYapanPersonelId: z.string().uuid().optional().nullable(),
    /** @deprecated geriye uyumluluk */
    tahsilatiYapanUserId: z.string().uuid().optional().nullable()
  })
  .superRefine((data, ctx) => {
    if (data.tip === KasaHareketTipi.MASRAF) {
      const mt = data.masrafTuru?.trim() ?? ''
      if (mt.length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Masraf türü zorunludur.', path: ['masrafTuru'] })
        return
      }
      if (!MASRAF_TURU_VALUES.includes(mt as MasrafTuruValue)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Geçersiz masraf türü.', path: ['masrafTuru'] })
        return
      }
      if (isDigerMasraf(mt)) {
        const oz = data.ozelMasrafAdi?.trim() ?? ''
        if (oz.length < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Diğer masraf için özel ad zorunludur.',
            path: ['ozelMasrafAdi']
          })
        }
      }
      const myk = data.masrafiYapanKisi?.trim() ?? ''
      if (myk.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Masrafı yapan kişi zorunludur.',
          path: ['masrafiYapanKisi']
        })
      }
    } else {
      if (data.masrafTuru?.trim() || data.ozelMasrafAdi?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Avans girişinde masraf türü kullanılmaz.', path: ['masrafTuru'] })
      }
      if (data.masrafiYapanKisi?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Avans girişinde masrafı yapan kişi alanı kullanılmaz.',
          path: ['masrafiYapanKisi']
        })
      }
    }
  })

export type CreateKasaHareketiBody = z.infer<typeof createKasaHareketiBodySchema>

export const rejectKasaBodySchema = z.object({
  redSebebi: z.string().trim().min(3, 'Red sebebi en az 3 karakter olmalıdır.').max(2000)
})

export type RejectKasaBody = z.infer<typeof rejectKasaBodySchema>

export const createDuzeltmeBodySchema = z.object({
  tarih: z.coerce.date(),
  tutar: tutarSigned.refine((n) => n !== 0, { message: 'Düzeltme tutarı sıfır olamaz.' }),
  aciklama: z.string().trim().min(3, 'Açıklama en az 3 karakter olmalıdır.').max(4000)
})

export type CreateDuzeltmeBody = z.infer<typeof createDuzeltmeBodySchema>

export const listKasaHareketleriQuerySchema = z.object({
  q: z.string().trim().optional().default(''),
  tip: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.nativeEnum(KasaHareketTipi).optional()
  ),
  onayDurumu: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.nativeEnum(KasaOnayDurumu).optional()
  ),
  page: z.preprocess((v) => (v === undefined || v === '' ? 1 : Number(v)), z.number().int().min(1)),
  limit: z.preprocess((v) => (v === undefined || v === '' ? 50 : Number(v)), z.number().int().min(1).max(200))
})

export type ListKasaHareketleriQuery = z.infer<typeof listKasaHareketleriQuerySchema>

export { KasaHareketTipi, KasaOnayDurumu, OdemeYontemi }
