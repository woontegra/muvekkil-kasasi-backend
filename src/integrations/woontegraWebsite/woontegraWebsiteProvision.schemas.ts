import { z } from 'zod'
import { AppError } from '../../middleware/errorHandler.js'

const SAAS_PRODUCT_CODE = 'MUVEKKIL_KASA_SAAS' as const

function jsonNullToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v: unknown) => (v === null ? undefined : v), schema)
}

export const woontegraWebsiteProvisionBodySchema = z
  .object({
    externalOrderId: z.string().trim().min(1).max(200),
    externalCustomerId: jsonNullToUndefined(z.string().trim().max(200).optional()),
    productCode: jsonNullToUndefined(z.string().trim().optional()),
    productSlug: jsonNullToUndefined(z.string().trim().optional()),
    customer: z.object({
      name: z.string().trim().min(1).max(300),
      email: z.string().trim().email().max(320),
      phone: jsonNullToUndefined(z.string().trim().max(80).optional())
    }),
    tenant: jsonNullToUndefined(
      z
        .object({
          name: jsonNullToUndefined(z.string().trim().max(500).optional()),
          officeName: jsonNullToUndefined(z.string().trim().max(500).optional()),
          phone: jsonNullToUndefined(z.string().trim().max(80).optional()),
          email: jsonNullToUndefined(z.string().trim().max(320).optional()),
          taxNumber: jsonNullToUndefined(z.string().trim().max(64).optional()),
          taxOffice: jsonNullToUndefined(z.string().trim().max(200).optional()),
          address: jsonNullToUndefined(z.string().trim().max(4000).optional())
        })
        .optional()
    ),
    licenseDays: z.coerce.number().int().min(1).max(3650).default(365),
    licenseStartDate: jsonNullToUndefined(z.coerce.date().optional()),
    licenseEndDate: jsonNullToUndefined(z.coerce.date().optional()),
    licenseStatus: z.enum(['AKTIF', 'DEMO']).default('AKTIF'),
    demoMu: z.boolean().optional(),
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
    const raw = (b.productCode ?? b.productSlug ?? '').trim()
    if (!raw) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'productCode veya productSlug zorunlu.',
        path: ['productCode']
      })
      return
    }
    if (raw !== SAAS_PRODUCT_CODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Yalnızca ${SAAS_PRODUCT_CODE} ürün kodu desteklenir.`,
        path: ['productCode']
      })
    }
    if (b.licenseEndDate && b.licenseStartDate && b.licenseEndDate.getTime() <= b.licenseStartDate.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'licenseEndDate, licenseStartDate tarihinden sonra olmalı.',
        path: ['licenseEndDate']
      })
    }
  })
  .transform((b) => ({
    ...b,
    productCode: SAAS_PRODUCT_CODE
  }))

export type WoontegraWebsiteProvisionBody = z.infer<typeof woontegraWebsiteProvisionBodySchema>

export function parseWoontegraWebsiteProvisionBody(input: unknown): WoontegraWebsiteProvisionBody {
  const result = woontegraWebsiteProvisionBodySchema.safeParse(input)
  if (!result.success) {
    throw new AppError(422, 'İstek gövdesi doğrulanamadı.', 'VALIDATION_ERROR')
  }
  return result.data
}
