import { z } from 'zod'
import { normalizeKullaniciAdi } from '../lib/normalizeKullaniciAdi.js'
import { AppError } from '../middleware/errorHandler.js'

const PRODUCT_CODES = ['MUVEKKIL_KASA_DEFTERI', 'MUVEKKIL_KASA_SAAS'] as const

const ownerUsernameSchema = z
  .string()
  .trim()
  .optional()
  .transform((s) => (s ? normalizeKullaniciAdi(s) : undefined))
  .pipe(z.string().min(3).max(64).regex(/^[a-z0-9._-]+$/).optional())

function jsonNullToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v: unknown) => (v === null ? undefined : v), schema)
}

export const provisionTenantBodySchema = z
  .object({
    externalOrderId: z.string().trim().min(1).max(200),
    externalCustomerId: jsonNullToUndefined(z.string().trim().max(200).optional()),
    productCode: z.enum(PRODUCT_CODES),
    licenseType: z.enum(['YEARLY', 'MONTHLY', 'TRIAL']).optional(),
    licenseStatus: z.enum(['AKTIF', 'DEMO']),
    licenseStartDate: z.coerce.date(),
    licenseEndDate: z.coerce.date(),
    tenant: z.object({
      name: z.string().trim().min(1).max(500),
      slug: jsonNullToUndefined(z.string().trim().max(80).optional()),
      phone: jsonNullToUndefined(z.string().trim().max(80).optional()),
      email: jsonNullToUndefined(z.string().trim().max(320).optional()),
      address: jsonNullToUndefined(z.string().trim().max(4000).optional()),
      taxNo: jsonNullToUndefined(z.string().trim().max(64).optional()),
      taxOffice: jsonNullToUndefined(z.string().trim().max(200).optional())
    }),
    owner: z.object({
      fullName: z.string().trim().min(1).max(300),
      email: jsonNullToUndefined(z.string().trim().max(320).optional()),
      username: ownerUsernameSchema,
      phone: jsonNullToUndefined(z.string().trim().max(80).optional())
    }),
    billing: z
      .object({
        amount: z.coerce.number().finite().nonnegative().optional(),
        currency: z.string().trim().max(8).optional(),
        paidAt: z.coerce.date().optional()
      })
      .optional(),
    notes: jsonNullToUndefined(z.string().trim().max(2000).optional())
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.licenseEndDate.getTime() <= b.licenseStartDate.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'licenseEndDate, licenseStartDate tarihinden sonra olmalı.',
        path: ['licenseEndDate']
      })
    }
    const hasEmail = !!b.owner.email?.trim()
    const hasUsername = !!b.owner.username?.trim()
    if (!hasEmail && !hasUsername) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'owner.email veya owner.username zorunlu.',
        path: ['owner']
      })
    }
  })

export type ProvisionTenantBody = z.infer<typeof provisionTenantBodySchema>

export function parseProvisionTenantBody(input: unknown): ProvisionTenantBody {
  const result = provisionTenantBodySchema.safeParse(input)
  if (!result.success) {
    throw new AppError(422, 'İstek gövdesi doğrulanamadı.', 'VALIDATION_ERROR')
  }
  return result.data
}
