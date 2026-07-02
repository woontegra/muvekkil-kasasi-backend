import { OdemeYontemi } from '@prisma/client'
import { z } from 'zod'

const tutarPositive = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v),
  z.number().finite().positive('Tutar pozitif olmalıdır.')
)

export const upsertVekaletUcretiBodySchema = z.object({
  toplamTutar: tutarPositive,
  aciklama: z.string().trim().max(4000).optional().nullable()
})

export type UpsertVekaletUcretiBody = z.infer<typeof upsertVekaletUcretiBodySchema>

export const createVekaletTaksitiBodySchema = z.object({
  taksitNo: z.coerce.number().int().min(1, 'Taksit no en az 1 olmalıdır.'),
  vadeTarihi: z.coerce.date(),
  tutar: tutarPositive,
  aciklama: z.string().trim().max(4000).optional().nullable()
})

export type CreateVekaletTaksitiBody = z.infer<typeof createVekaletTaksitiBodySchema>

export const updateVekaletTaksitiBodySchema = z.object({
  taksitNo: z.coerce.number().int().min(1).optional(),
  vadeTarihi: z.coerce.date().optional(),
  tutar: tutarPositive.optional(),
  odemeDurumu: z.enum(['ODENMEDI', 'ODENDI']).optional(),
  odemeTarihi: z.coerce.date().optional().nullable(),
  aciklama: z.string().trim().max(4000).optional().nullable()
})

export type UpdateVekaletTaksitiBody = z.infer<typeof updateVekaletTaksitiBodySchema>

export const markTaksitPaidBodySchema = z.object({
  odemeTarihi: z.coerce.date().optional(),
  aciklama: z.string().trim().max(4000).optional().nullable()
})

export type MarkTaksitPaidBody = z.infer<typeof markTaksitPaidBodySchema>

export const markTaksitSmmBodySchema = z.object({
  smmNo: z.string().trim().min(1, 'SMM no zorunludur.').max(120),
  smmKesimTarihi: z.coerce.date(),
  smmAciklama: z.string().trim().max(4000).optional().nullable()
})

export type MarkTaksitSmmBody = z.infer<typeof markTaksitSmmBodySchema>

export const createVekaletTaksitOdemeBodySchema = z.object({
  tutar: tutarPositive,
  odemeTarihi: z.coerce.date().optional(),
  odemeYontemi: z.nativeEnum(OdemeYontemi),
  aciklama: z.string().trim().max(4000).optional().nullable(),
  smmKesildiMi: z.boolean().optional().default(false),
  tahsilatiYapanPersonelId: z.string().uuid().optional().nullable(),
  tahsilatiYapanUserId: z.string().uuid().optional().nullable()
})

export type CreateVekaletTaksitOdemeBody = z.infer<typeof createVekaletTaksitOdemeBodySchema>

export const createVekaletPesinOdemeBodySchema = createVekaletTaksitOdemeBodySchema

export type CreateVekaletPesinOdemeBody = z.infer<typeof createVekaletPesinOdemeBodySchema>

export const createVekaletTaksitPlaniBodySchema = z.object({
  taksitSayisi: z.coerce.number().int().min(1).max(120),
  ilkVadeTarihi: z.coerce.date(),
  taksitTutari: tutarPositive,
  aciklama: z.string().trim().max(4000).optional().nullable()
})

export type CreateVekaletTaksitPlaniBody = z.infer<typeof createVekaletTaksitPlaniBodySchema>

export const createTekVekaletTaksitiBodySchema = z.object({
  vadeTarihi: z.coerce.date(),
  tutar: tutarPositive.optional(),
  aciklama: z.string().trim().max(4000).optional().nullable()
})

export type CreateTekVekaletTaksitiBody = z.infer<typeof createTekVekaletTaksitiBodySchema>
