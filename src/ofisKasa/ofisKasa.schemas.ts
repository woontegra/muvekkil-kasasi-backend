import { OfisKasaIslemTipi, OfisKasaOdemeYontemi, OfisKasaOnayDurumu } from '@prisma/client'
import { z } from 'zod'

export const OFIS_KASA_GELIR_KATEGORILERI = [
  'Vekalet ücreti dışı gelir',
  'Danışmanlık geliri',
  'İade alınan ödeme',
  'Diğer gelir'
] as const

export const OFIS_KASA_GIDER_KATEGORILERI = [
  'Ofis kirası',
  'Personel maaşı',
  'SGK ödemesi',
  'Vergi ödemesi',
  'Stopaj',
  'Muhasebe ücreti',
  'Elektrik',
  'Su',
  'İnternet / telefon',
  'Kırtasiye',
  'Ulaşım',
  'Yemek',
  'Temizlik',
  'Demirbaş',
  'Yazılım / abonelik',
  'Banka masrafı',
  'Diğer gider'
] as const

export type OfisKasaGelirKategori = (typeof OFIS_KASA_GELIR_KATEGORILERI)[number]
export type OfisKasaGiderKategori = (typeof OFIS_KASA_GIDER_KATEGORILERI)[number]

export function isDigerGelir(k: string): boolean {
  return k === 'Diğer gelir'
}

export function isDigerGider(k: string): boolean {
  return k === 'Diğer gider'
}

const tutarPositive = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v),
  z.number().finite().positive('Tutar pozitif olmalıdır.')
)

const tutarSigned = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v),
  z.number().finite({ message: 'Geçerli bir tutar girin.' })
)

export const createOfisKasaHareketiBodySchema = z
  .object({
    islemTipi: z.enum([OfisKasaIslemTipi.GELIR, OfisKasaIslemTipi.GIDER]),
    tarih: z.coerce.date(),
    kategori: z.string().trim().min(2).max(120),
    ozelKategoriAdi: z.string().trim().max(200).optional().nullable(),
    aciklama: z.string().trim().max(4000).optional().nullable(),
    tutar: tutarPositive,
    odemeYontemi: z.nativeEnum(OfisKasaOdemeYontemi)
  })
  .superRefine((data, ctx) => {
    if (data.islemTipi === OfisKasaIslemTipi.GELIR) {
      if (!OFIS_KASA_GELIR_KATEGORILERI.includes(data.kategori as OfisKasaGelirKategori)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Geçersiz gelir kategorisi.', path: ['kategori'] })
        return
      }
      if (isDigerGelir(data.kategori)) {
        const oz = data.ozelKategoriAdi?.trim() ?? ''
        if (oz.length < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Diğer gelir için özel kategori adı zorunludur.',
            path: ['ozelKategoriAdi']
          })
        }
      } else if (data.ozelKategoriAdi?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Özel kategori adı yalnızca «Diğer gelir» için kullanılır.',
          path: ['ozelKategoriAdi']
        })
      }
    } else {
      if (!OFIS_KASA_GIDER_KATEGORILERI.includes(data.kategori as OfisKasaGiderKategori)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Geçersiz gider kategorisi.', path: ['kategori'] })
        return
      }
      if (isDigerGider(data.kategori)) {
        const oz = data.ozelKategoriAdi?.trim() ?? ''
        if (oz.length < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Diğer gider için özel kategori adı zorunludur.',
            path: ['ozelKategoriAdi']
          })
        }
      } else if (data.ozelKategoriAdi?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Özel kategori adı yalnızca «Diğer gider» için kullanılır.',
          path: ['ozelKategoriAdi']
        })
      }
    }
  })

export type CreateOfisKasaHareketiBody = z.infer<typeof createOfisKasaHareketiBodySchema>

export const rejectOfisKasaBodySchema = z.object({
  redSebebi: z.string().trim().min(3, 'Red sebebi en az 3 karakter olmalıdır.').max(2000)
})

export type RejectOfisKasaBody = z.infer<typeof rejectOfisKasaBodySchema>

export const createOfisKasaDuzeltmeBodySchema = z.object({
  tarih: z.coerce.date(),
  tutar: tutarSigned.refine((n) => n !== 0, { message: 'Düzeltme tutarı sıfır olamaz.' }),
  aciklama: z.string().trim().min(3, 'Açıklama en az 3 karakter olmalıdır.').max(4000),
  odemeYontemi: z.nativeEnum(OfisKasaOdemeYontemi)
})

export type CreateOfisKasaDuzeltmeBody = z.infer<typeof createOfisKasaDuzeltmeBodySchema>

export const listOfisKasaHareketleriQuerySchema = z.object({
  q: z.string().trim().optional().default(''),
  islemTipi: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.nativeEnum(OfisKasaIslemTipi).optional()
  ),
  onayDurumu: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.nativeEnum(OfisKasaOnayDurumu).optional()
  ),
  kategori: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.string().trim().min(1).max(120).optional()
  ),
  startDate: z.preprocess((v) => (v === '' || v === undefined || v === null ? undefined : v), z.coerce.date().optional()),
  endDate: z.preprocess((v) => (v === '' || v === undefined || v === null ? undefined : v), z.coerce.date().optional()),
  page: z.preprocess((v) => (v === undefined || v === '' ? 1 : Number(v)), z.number().int().min(1)),
  limit: z.preprocess((v) => (v === undefined || v === '' ? 50 : Number(v)), z.number().int().min(1).max(200))
})

export type ListOfisKasaHareketleriQuery = z.infer<typeof listOfisKasaHareketleriQuerySchema>

export { OfisKasaIslemTipi, OfisKasaOdemeYontemi, OfisKasaOnayDurumu }
