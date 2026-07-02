import { z } from 'zod'

export const createPrimPersonelBodySchema = z.object({
  adSoyad: z.string().trim().min(2, 'Ad soyad en az 2 karakter olmalıdır.').max(200),
  telefon: z.string().trim().max(40).optional().nullable(),
  eposta: z.string().trim().email('Geçersiz e-posta.').max(200).optional().nullable().or(z.literal('')),
  unvan: z.string().trim().max(120).optional().nullable(),
  not: z.string().trim().max(2000).optional().nullable(),
  bagliUserId: z.string().uuid().optional().nullable(),
  aktifMi: z.boolean().optional().default(true)
})

export const updatePrimPersonelBodySchema = createPrimPersonelBodySchema.partial()

export const listPrimPersonelQuerySchema = z.object({
  q: z.string().trim().optional().default(''),
  aktifMi: z
    .preprocess((v) => (v === '' || v === undefined || v === null ? undefined : v === 'true' || v === true), z.boolean().optional()),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200)
})

export const linkKullanicilarQuerySchema = z.object({
  exceptPersonelId: z.string().uuid().optional()
})

export type CreatePrimPersonelBody = z.infer<typeof createPrimPersonelBodySchema>
export type UpdatePrimPersonelBody = z.infer<typeof updatePrimPersonelBodySchema>
export type ListPrimPersonelQuery = z.infer<typeof listPrimPersonelQuerySchema>
export type LinkKullanicilarQuery = z.infer<typeof linkKullanicilarQuerySchema>
