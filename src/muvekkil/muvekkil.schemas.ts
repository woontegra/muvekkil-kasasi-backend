import { MuvekkilTur } from '@prisma/client'
import { z } from 'zod'

const emptyToNull = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).trim()
  return s.length === 0 ? null : s
}

const optionalNote = z.preprocess(emptyToNull, z.string().max(8000).nullable())

const optionalNullableString = z.preprocess(emptyToNull, z.string().max(500).nullable())

function emailCheck(val: string | null | undefined, ctx: z.RefinementCtx, path: (string | number)[]): void {
  if (val == null || val === '') return
  if (!z.string().email().safeParse(val).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Geçerli bir e-posta girin.', path })
  }
}

const muvekkilWriteBase = z.object({
  adSoyad: z.string().trim().default(''),
  sirketUnvani: optionalNullableString,
  telefon: z.string().trim().default(''),
  eposta: optionalNullableString,
  not: optionalNote,
  yetkiliAdSoyad: z.string().trim().default(''),
  yetkiliTelefon: z.string().trim().default(''),
  mudurAdSoyad: z.string().trim().default(''),
  mudurTelefon: z.string().trim().default(''),
  muhasebeAdSoyad: z.string().trim().default(''),
  muhasebeTelefon: z.string().trim().default('')
})

export const createMuvekkilBodySchema = muvekkilWriteBase
  .extend({
    tur: z.nativeEnum(MuvekkilTur)
  })
  .superRefine((data, ctx) => {
    emailCheck(data.eposta ?? null, ctx, ['eposta'])
    if (data.tur === MuvekkilTur.GERCEK) {
      if (data.adSoyad.trim().length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ad soyad en az 2 karakter olmalıdır.', path: ['adSoyad'] })
      }
      if (data.telefon.trim().length < 3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefon zorunludur.', path: ['telefon'] })
      }
    } else {
      const su = data.sirketUnvani?.trim() ?? ''
      if (su.length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Şirket ünvanı en az 2 karakter olmalıdır.', path: ['sirketUnvani'] })
      }
      const yAd = data.yetkiliAdSoyad.trim().length >= 2
      const yTel = data.yetkiliTelefon.trim().length >= 3
      if (!yAd && !yTel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Tüzel müvekkil için yetkili adı soyadı veya yetkili telefon girilmelidir.',
          path: ['yetkiliAdSoyad']
        })
      }
    }
  })

export type CreateMuvekkilBody = z.infer<typeof createMuvekkilBodySchema>

export const updateMuvekkilBodySchema = createMuvekkilBodySchema

export const listMuvekkilQuerySchema = z.object({
  q: z.string().trim().optional().default(''),
  tur: z.nativeEnum(MuvekkilTur).optional(),
  page: z.preprocess((v) => (v === undefined || v === '' ? 1 : Number(v)), z.number().int().min(1)),
  limit: z.preprocess((v) => (v === undefined || v === '' ? 20 : Number(v)), z.number().int().min(1).max(100))
})

export type ListMuvekkilQuery = z.infer<typeof listMuvekkilQuerySchema>
