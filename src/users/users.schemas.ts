import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { normalizeKullaniciAdi } from '../lib/normalizeKullaniciAdi.js'

const kullaniciAdiSchema = z
  .string()
  .trim()
  .transform((s) => normalizeKullaniciAdi(s))
  .pipe(
    z
      .string()
      .min(3, 'Kullanıcı adı en az 3 karakter olmalıdır.')
      .max(64)
      .regex(/^[a-z0-9._-]+$/, 'Kullanıcı adı küçük harf, rakam, nokta, alt çizgi ve tire içerebilir.')
  )

const epostaOptionalSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().email('Geçerli bir e-posta girin.').optional()
).transform((s) => (s ? s.toLowerCase() : null))

export const listUsersQuerySchema = z.object({
  q: z.string().trim().optional().default(''),
  rol: z.nativeEnum(UserRole).optional(),
  aktifMi: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
})

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>

export const createUserBodySchema = z.object({
  adSoyad: z.string().trim().min(2, 'Ad soyad en az 2 karakter olmalıdır.'),
  kullaniciAdi: kullaniciAdiSchema,
  eposta: epostaOptionalSchema,
  telefon: z.string().trim().max(40).optional().nullable().transform((v) => (v?.trim() ? v.trim() : null)),
  rol: z.enum([UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL] as [UserRole, UserRole], {
    errorMap: () => ({ message: 'Rol yalnızca avukat/yönetici veya katip/personel olabilir.' })
  }),
  sifre: z.string().min(8, 'Şifre en az 8 karakter olmalıdır.').max(200)
})

export type CreateUserBody = z.infer<typeof createUserBodySchema>

export const updateUserBodySchema = z.object({
  adSoyad: z.string().trim().min(2, 'Ad soyad en az 2 karakter olmalıdır.'),
  eposta: epostaOptionalSchema,
  telefon: z.string().trim().max(40).optional().nullable().transform((v) => (v?.trim() ? v.trim() : null)),
  /** Avukat/katip güncellemesinde AVUKAT|KATIP; büro sahibi kendi profilinde BURO_SAHIBI sabit gönderilir. */
  rol: z.nativeEnum(UserRole),
  aktifMi: z.boolean()
})

export type UpdateUserBody = z.infer<typeof updateUserBodySchema>

export const resetUserPasswordBodySchema = z.object({
  yeniSifre: z.string().min(8, 'Şifre en az 8 karakter olmalıdır.').max(200)
})

export type ResetUserPasswordBody = z.infer<typeof resetUserPasswordBodySchema>
