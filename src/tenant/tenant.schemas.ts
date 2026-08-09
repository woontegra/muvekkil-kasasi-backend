import { z } from 'zod'

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v))

const optionalNullableText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v))

export const tenantProfileUpdateBodySchema = z
  .object({
    buroAdi: z.string().trim().min(1, 'Büro adı zorunludur.').max(500).optional(),
    telefon: optionalNullableText(80),
    eposta: z.union([z.string().trim().email('Geçerli e-posta girin.').max(320), z.null()]).optional(),
    adres: optionalNullableText(4000),
    vergiNo: optionalNullableText(64),
    vergiDairesi: optionalNullableText(200)
  })
  .refine(
    (b) =>
      b.buroAdi !== undefined ||
      b.telefon !== undefined ||
      b.eposta !== undefined ||
      b.adres !== undefined ||
      b.vergiNo !== undefined ||
      b.vergiDairesi !== undefined,
    { message: 'Güncellenecek en az bir alan girin.' }
  )

export type TenantProfileUpdateBody = z.infer<typeof tenantProfileUpdateBodySchema>
