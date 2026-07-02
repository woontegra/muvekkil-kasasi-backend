import { IcraTahsilatAlacakDurum, IcraTahsilatAlacakTuru, OfisKasaOdemeYontemi } from '@prisma/client'
import { z } from 'zod'

const tutarPositive = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v),
  z.number().finite().positive('Tutar pozitif olmalıdır.')
)

const tutarNonNegative = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v),
  z.number().finite().min(0, 'Tutar negatif olamaz.')
)

export const icraTahsilatTipiSchema = z.enum(['PESIN_TAHSIL', 'PESINAT_TAKSIT', 'SADECE_TAKSIT'])

export type IcraTahsilatTipi = z.infer<typeof icraTahsilatTipiSchema>

export const listIcraTahsilatQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  alacakTuru: z.nativeEnum(IcraTahsilatAlacakTuru).optional(),
  durum: z.nativeEnum(IcraTahsilatAlacakDurum).optional(),
  tahsilatiYapanPersonelId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50)
})

function resolveIcraTahsilatTipi(data: {
  tahsilatTipi?: IcraTahsilatTipi
  pesinatVar?: boolean
  taksitSayisi: number
}): IcraTahsilatTipi {
  if (data.tahsilatTipi) return data.tahsilatTipi
  if (data.taksitSayisi === 0) return 'PESIN_TAHSIL'
  if (data.pesinatVar) return 'PESINAT_TAKSIT'
  return 'SADECE_TAKSIT'
}

export { resolveIcraTahsilatTipi }

export const createIcraTahsilatBodySchema = z
  .object({
    alacakTuru: z.nativeEnum(IcraTahsilatAlacakTuru),
    borcluAd: z.string().trim().min(2).max(200),
    muvekkilId: z.string().uuid().optional().nullable(),
    dosyaId: z.string().uuid().optional().nullable(),
    toplamTutar: tutarPositive,
    tahsilatTipi: icraTahsilatTipiSchema.optional(),
    pesinatVar: z.boolean().optional().default(false),
    pesinatTutar: tutarNonNegative.optional(),
    taksitSayisi: z.coerce.number().int().min(0).max(120),
    ilkVadeTarihi: z.coerce.date().optional(),
    tahsilatTarihi: z.coerce.date().optional(),
    odemeYontemi: z.nativeEnum(OfisKasaOdemeYontemi),
    tahsilatiYapanPersonelId: z.string().uuid().optional().nullable(),
    tahsilatiYapanUserId: z.string().uuid().optional().nullable(),
    aciklama: z.string().trim().max(4000).optional().nullable()
  })
  .superRefine((data, ctx) => {
    const tip = resolveIcraTahsilatTipi(data)
    const pesinat = tip === 'PESINAT_TAKSIT' ? Number(data.pesinatTutar ?? 0) : 0

    if (tip === 'PESIN_TAHSIL') {
      if (data.taksitSayisi !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Peşin tahsilatta taksit sayısı 0 olmalıdır.',
          path: ['taksitSayisi']
        })
      }
      if (!data.tahsilatiYapanPersonelId && !data.tahsilatiYapanUserId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Peşin tahsilat için tahsilatı yapan personel zorunludur.',
          path: ['tahsilatiYapanPersonelId']
        })
      }
      return
    }

    if (data.taksitSayisi < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Taksit sayısı en az 1 olmalıdır.',
        path: ['taksitSayisi']
      })
    }
    if (!data.ilkVadeTarihi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'İlk vade tarihi zorunludur.',
        path: ['ilkVadeTarihi']
      })
    }

    if (tip === 'PESINAT_TAKSIT') {
      if (pesinat <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Peşinat tutarı zorunludur.',
          path: ['pesinatTutar']
        })
      }
      if (pesinat > data.toplamTutar) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Peşinat toplam tutarı aşamaz.', path: ['pesinatTutar'] })
      }
      if (!data.tahsilatiYapanPersonelId && !data.tahsilatiYapanUserId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Peşinat için tahsilatı yapan personel zorunludur.',
          path: ['tahsilatiYapanPersonelId']
        })
      }
    }
  })

export const patchIcraTahsilatBodySchema = z.object({
  borcluAd: z.string().trim().min(2).max(200).optional(),
  muvekkilId: z.string().uuid().optional().nullable(),
  dosyaId: z.string().uuid().optional().nullable(),
  aciklama: z.string().trim().max(4000).optional().nullable(),
  durum: z.literal(IcraTahsilatAlacakDurum.IPTAL).optional()
})

export const patchIcraTaksitBodySchema = z.object({
  vadeTarihi: z.coerce.date().optional(),
  tutar: tutarPositive.optional(),
  aciklama: z.string().trim().max(2000).optional().nullable()
})

export const createIcraTaksitOdemeBodySchema = z.object({
  tutar: tutarPositive,
  odemeTarihi: z.coerce.date(),
  odemeYontemi: z.nativeEnum(OfisKasaOdemeYontemi),
  tahsilatiYapanPersonelId: z.string().uuid().optional().nullable(),
  tahsilatiYapanUserId: z.string().uuid().optional().nullable(),
  aciklama: z.string().trim().max(4000).optional().nullable()
})

export type ListIcraTahsilatQuery = z.infer<typeof listIcraTahsilatQuerySchema>
export type CreateIcraTahsilatBody = z.infer<typeof createIcraTahsilatBodySchema>
export type PatchIcraTahsilatBody = z.infer<typeof patchIcraTahsilatBodySchema>
export type PatchIcraTaksitBody = z.infer<typeof patchIcraTaksitBodySchema>
export type CreateIcraTaksitOdemeBody = z.infer<typeof createIcraTaksitOdemeBodySchema>
