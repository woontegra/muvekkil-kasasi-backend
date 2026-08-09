import { z } from 'zod'
import { AppError } from '../../middleware/errorHandler.js'
import { LICENSE_PURCHASE_PRODUCT_CODE } from './licensePurchase.service.js'

const jsonNullToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v: unknown) => (v === null ? undefined : v), schema)

export const licensePurchaseResolveBodySchema = z
  .object({
    renewalToken: z.string().trim().min(32).max(200)
  })
  .strict()

export const licensePurchasePreviewBodySchema = z
  .object({
    renewalToken: z.string().trim().min(32).max(200),
    renewalDays: z.coerce.number().int().min(1).max(3650)
  })
  .strict()

export type LicensePurchasePreviewBody = z.infer<typeof licensePurchasePreviewBodySchema>

export const licensePurchaseBindBodySchema = z
  .object({
    renewalToken: z.string().trim().min(32).max(200),
    externalOrderId: z.string().trim().min(1).max(200),
    checkoutEmail: jsonNullToUndefined(z.string().trim().email().max(320).optional())
  })
  .strict()

export type LicensePurchaseBindBody = z.infer<typeof licensePurchaseBindBodySchema>

export const licensePurchaseFulfillBodySchema = z
  .object({
    externalOrderId: z.string().trim().min(1).max(200),
    productCode: jsonNullToUndefined(z.string().trim().optional()),
    renewalDays: z.coerce.number().int().min(1).max(3650).default(365),
    externalCustomerId: jsonNullToUndefined(z.string().trim().min(1).max(200).optional()),
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
    if (raw && raw !== LICENSE_PURCHASE_PRODUCT_CODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Yalnızca ${LICENSE_PURCHASE_PRODUCT_CODE} ürün kodu desteklenir.`,
        path: ['productCode']
      })
    }
  })
  .transform((b) => ({
    ...b,
    productCode: LICENSE_PURCHASE_PRODUCT_CODE as typeof LICENSE_PURCHASE_PRODUCT_CODE
  }))

export type LicensePurchaseFulfillBody = z.infer<typeof licensePurchaseFulfillBodySchema>

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new AppError(422, message, 'VALIDATION_ERROR')
  }
  return result.data
}

export function parseLicensePurchaseResolveBody(input: unknown): z.infer<typeof licensePurchaseResolveBodySchema> {
  return parseOrThrow(licensePurchaseResolveBodySchema, input, 'İstek gövdesi doğrulanamadı.')
}

export function parseLicensePurchasePreviewBody(input: unknown): LicensePurchasePreviewBody {
  return parseOrThrow(licensePurchasePreviewBodySchema, input, 'İstek gövdesi doğrulanamadı.') as LicensePurchasePreviewBody
}

export function parseLicensePurchaseBindBody(input: unknown): LicensePurchaseBindBody {
  return parseOrThrow(licensePurchaseBindBodySchema, input, 'İstek gövdesi doğrulanamadı.') as LicensePurchaseBindBody
}

export function parseLicensePurchaseFulfillBody(input: unknown): LicensePurchaseFulfillBody {
  return parseOrThrow(licensePurchaseFulfillBodySchema, input, 'İstek gövdesi doğrulanamadı.') as LicensePurchaseFulfillBody
}
