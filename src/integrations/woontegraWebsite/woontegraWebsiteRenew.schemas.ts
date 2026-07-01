import { z } from 'zod'
import { AppError } from '../../middleware/errorHandler.js'

const SAAS_PRODUCT_CODE = 'MUVEKKIL_KASA_SAAS' as const

const RENEWAL_IDENTITY_MSG =
  'Üyelik yenileme için tenantId + lisans anahtarı veya müşteri ID + lisans anahtarı gereklidir.'

function jsonNullToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v: unknown) => (v === null ? undefined : v), schema)
}

export const woontegraWebsiteRenewBodySchema = z
  .object({
    externalOrderId: z.string().trim().min(1).max(200),
    externalCustomerId: z.string().trim().min(1).max(200),
    productCode: jsonNullToUndefined(z.string().trim().optional()),
    tenantId: jsonNullToUndefined(z.string().uuid().optional()),
    licenseKey: jsonNullToUndefined(z.string().trim().min(1).max(200).optional()),
    /** Yalnızca iletişim / bilgilendirme maili; eşleştirmede kullanılmaz. */
    ownerEmail: jsonNullToUndefined(z.string().trim().email().max(320).optional()),
    renewalDays: z.coerce.number().int().min(1).max(3650).default(365),
    billing: jsonNullToUndefined(
      z
        .object({
          amount: z.coerce.number().finite().nonnegative().optional(),
          currency: z.string().trim().max(8).default('TRY'),
          paidAt: jsonNullToUndefined(z.coerce.date().optional())
        })
        .optional()
    ),
    notes: jsonNullToUndefined(z.string().trim().max(2000).optional())
  })
  .strict()
  .superRefine((b, ctx) => {
    const raw = (b.productCode ?? '').trim()
    if (raw && raw !== SAAS_PRODUCT_CODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Yalnızca ${SAAS_PRODUCT_CODE} ürün kodu desteklenir.`,
        path: ['productCode']
      })
    }
    if (!b.licenseKey?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: RENEWAL_IDENTITY_MSG,
        path: ['licenseKey']
      })
    }
  })
  .transform((b) => ({
    ...b,
    productCode: SAAS_PRODUCT_CODE as typeof SAAS_PRODUCT_CODE,
    licenseKey: b.licenseKey!.trim()
  }))

export type WoontegraWebsiteRenewBody = z.infer<typeof woontegraWebsiteRenewBodySchema>

export function parseWoontegraWebsiteRenewBody(input: unknown): WoontegraWebsiteRenewBody {
  const result = woontegraWebsiteRenewBodySchema.safeParse(input)
  if (!result.success) {
    const licenseKeyIssue = result.error.issues.find((i) => i.path[0] === 'licenseKey')
    if (licenseKeyIssue) {
      throw new AppError(422, RENEWAL_IDENTITY_MSG, 'RENEWAL_IDENTITY_REQUIRED')
    }
    throw new AppError(422, 'İstek gövdesi doğrulanamadı.', 'VALIDATION_ERROR')
  }
  return result.data
}
