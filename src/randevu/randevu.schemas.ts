import { z } from 'zod'

const emptyToNull = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).trim()
  return s.length === 0 ? null : s
}

const optionalNullableString = z.preprocess(emptyToNull, z.string().max(2000).nullable())

const isoDateTime = z
  .string()
  .trim()
  .min(1, 'Tarih/saat zorunludur.')
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Geçersiz tarih/saat.' })

const optionalUuid = z.preprocess(
  (v) => (v === '' || v == null ? null : v),
  z.string().uuid('Geçersiz id.').nullable()
)

const hatirlatmaPlanSchema = z
  .object({
    mode: z.enum(['VARSAYILAN', 'OZEL', 'KAPALI']),
    kurallar: z
      .array(
        z.object({
          ruleKey: z.string().min(1).max(32),
          aktifMi: z.boolean(),
          offsetDk: z.number().int().min(1).max(60 * 24 * 30),
          metaSablonId: z.string().uuid().nullable().optional()
        })
      )
      .optional()
  })
  .optional()

const randevuWriteBase = z
  .object({
    baslik: z.string().trim().min(1, 'Başlık zorunludur.').max(500),
    baslangicAt: isoDateTime,
    bitisAt: isoDateTime,
    konum: optionalNullableString,
    aciklama: optionalNullableString,
    muvekkilId: optionalUuid,
    dosyaId: optionalUuid,
    sorumluUserId: optionalUuid,
    hatirlatmaPlan: hatirlatmaPlanSchema
  })
  .superRefine((data, ctx) => {
    const start = Date.parse(data.baslangicAt)
    const end = Date.parse(data.bitisAt)
    if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bitiş saati başlangıçtan sonra olmalıdır.',
        path: ['bitisAt']
      })
    }
  })

export const createRandevuBodySchema = randevuWriteBase
export type CreateRandevuBody = z.infer<typeof createRandevuBodySchema>

export const updateRandevuBodySchema = randevuWriteBase
export type UpdateRandevuBody = z.infer<typeof updateRandevuBodySchema>

export const listRandevuQuerySchema = z.object({
  baslangic: isoDateTime,
  bitis: isoDateTime,
  muvekkilId: z.string().uuid().optional(),
  sorumluUserId: z.string().uuid().optional()
})

export type ListRandevuQuery = z.infer<typeof listRandevuQuerySchema>
