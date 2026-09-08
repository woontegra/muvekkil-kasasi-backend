import { OdemeYontemi } from '@prisma/client'
import { z } from 'zod'

const tutarPositive = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v
    // TR: "26.666,66" | "26666,66" | "26666.66"
    const s = v.trim()
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || (s.includes(',') && s.includes('.'))) {
      return Number(s.replace(/\./g, '').replace(',', '.'))
    }
    if (s.includes(',')) return Number(s.replace(',', '.'))
    return Number(s)
  },
  z.number().finite().positive('Tutar pozitif olmalıdır.')
)

/**
 * Takvim gününü UTC gece yarısına sabitle (TR gün kayması yok).
 * Kabul: YYYY-MM-DD, DD.MM.YYYY, ISO (gün kısmı alınır).
 */
export function normalizeCalendarDateUtc(input: unknown): Date | unknown {
  if (input == null || input === '') return input
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return input
    const y = input.getUTCFullYear()
    const m = String(input.getUTCMonth() + 1).padStart(2, '0')
    const d = String(input.getUTCDate()).padStart(2, '0')
    return new Date(`${y}-${m}-${d}T00:00:00.000Z`)
  }
  if (typeof input === 'string') {
    const s = input.trim()
    const tr = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s)
    if (tr) return new Date(`${tr[3]}-${tr[2]}-${tr[1]}T00:00:00.000Z`)
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
    if (ymd) return new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00.000Z`)
  }
  return input
}

const calendarDate = z.preprocess(
  normalizeCalendarDateUtc,
  z.date({ errorMap: () => ({ message: 'Geçersiz vade tarihi.' }) })
)

export const upsertVekaletUcretiBodySchema = z.object({
  toplamTutar: tutarPositive,
  aciklama: z.string().trim().max(4000).optional().nullable()
})

export type UpsertVekaletUcretiBody = z.infer<typeof upsertVekaletUcretiBodySchema>

export const createVekaletTaksitiBodySchema = z.object({
  taksitNo: z.coerce.number().int().min(1, 'Taksit no en az 1 olmalıdır.'),
  vadeTarihi: calendarDate,
  tutar: tutarPositive,
  aciklama: z.string().trim().max(4000).optional().nullable()
})

export type CreateVekaletTaksitiBody = z.infer<typeof createVekaletTaksitiBodySchema>

export const updateVekaletTaksitiBodySchema = z.object({
  taksitNo: z.coerce.number().int().min(1).optional(),
  vadeTarihi: calendarDate.optional(),
  tutar: tutarPositive.optional(),
  odemeDurumu: z.enum(['ODENMEDI', 'ODENDI']).optional(),
  odemeTarihi: z.union([calendarDate, z.null()]).optional(),
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

/** Kısmi/tam tahsilat kaydını düzenleme — tutar kalan borç + bu kaydın eski tutarını aşamaz. */
export const updateVekaletTaksitOdemeBodySchema = z.object({
  tutar: tutarPositive.optional(),
  odemeTarihi: z.coerce.date().optional(),
  odemeYontemi: z.nativeEnum(OdemeYontemi).optional(),
  aciklama: z.string().trim().max(4000).optional().nullable()
})

export type UpdateVekaletTaksitOdemeBody = z.infer<typeof updateVekaletTaksitOdemeBodySchema>

export const createVekaletTaksitPlaniBodySchema = z
  .object({
    tip: z.enum(['ESIT', 'OZEL']).default('ESIT'),
    taksitSayisi: z.coerce.number().int().min(1).max(120).optional(),
    ilkVadeTarihi: z.coerce.date().optional(),
    taksitTutari: tutarPositive.optional(),
    aciklama: z.string().trim().max(4000).optional().nullable(),
    satirlar: z
      .array(
        z.object({
          tutar: tutarPositive,
          vadeTarihi: z.coerce.date(),
          aciklama: z.string().trim().max(4000).optional().nullable()
        })
      )
      .min(1)
      .max(120)
      .optional()
  })
  .superRefine((data, ctx) => {
    if (data.tip === 'OZEL') {
      if (!data.satirlar || data.satirlar.length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Özel plan için en az bir satır gerekir.', path: ['satirlar'] })
      }
      return
    }
    if (data.taksitSayisi == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Taksit sayısı zorunludur.', path: ['taksitSayisi'] })
    }
    if (data.ilkVadeTarihi == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'İlk vade tarihi zorunludur.', path: ['ilkVadeTarihi'] })
    }
    if (data.taksitTutari == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Taksit tutarı zorunludur.', path: ['taksitTutari'] })
    }
  })

export type CreateVekaletTaksitPlaniBody = z.infer<typeof createVekaletTaksitPlaniBodySchema>

export const createTekVekaletTaksitiBodySchema = z.object({
  vadeTarihi: z.coerce.date(),
  tutar: tutarPositive.optional(),
  aciklama: z.string().trim().max(4000).optional().nullable()
})

export type CreateTekVekaletTaksitiBody = z.infer<typeof createTekVekaletTaksitiBodySchema>
