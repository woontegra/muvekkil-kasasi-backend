import { FinansKalemTuru } from '@prisma/client'
import { z } from 'zod'

export const listFinansKalemleriQuerySchema = z.object({
  tur: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.nativeEnum(FinansKalemTuru).optional()
  ),
  /** true=yalnız aktif, false=yalnız pasif, all=hepsi. Varsayılan: true (formlar). */
  aktif: z.preprocess((v) => {
    if (v === '' || v === undefined || v === null) return 'true'
    if (v === true || v === 'true' || v === '1') return 'true'
    if (v === false || v === 'false' || v === '0') return 'false'
    if (v === 'all') return 'all'
    return String(v)
  }, z.enum(['true', 'false', 'all'])),
  /** Yönetim UI: sistem kalemlerini de getir. Formlar: false. */
  includeSistem: z.preprocess((v) => {
    if (v === true || v === 'true' || v === '1') return true
    return false
  }, z.boolean())
})

export type ListFinansKalemleriQuery = z.infer<typeof listFinansKalemleriQuerySchema>

export const createFinansKalemiBodySchema = z.object({
  tur: z.nativeEnum(FinansKalemTuru),
  ad: z.string().trim().min(2, 'Kalem adı en az 2 karakter olmalıdır.').max(120)
})

export type CreateFinansKalemiBody = z.infer<typeof createFinansKalemiBodySchema>

export const updateFinansKalemiBodySchema = z.object({
  ad: z.string().trim().min(2).max(120).optional(),
  /** Aynı tür içinde yeni sıra (0-based veya 1-based fark etmez; servis clamp eder). */
  sira: z.number().int().min(0).max(10_000).optional()
})

export type UpdateFinansKalemiBody = z.infer<typeof updateFinansKalemiBodySchema>

export const reorderFinansKalemleriBodySchema = z.object({
  tur: z.nativeEnum(FinansKalemTuru),
  orderedIds: z.array(z.string().uuid()).min(1).max(500)
})

export type ReorderFinansKalemleriBody = z.infer<typeof reorderFinansKalemleriBodySchema>
