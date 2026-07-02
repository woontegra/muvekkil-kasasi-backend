import { z } from 'zod'
import { normalizeLoginIdentifier } from '../lib/normalizeKullaniciAdi.js'

export const loginBodySchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, 'E-posta veya kullanıcı adı zorunludur.')
    .transform((s) => normalizeLoginIdentifier(s)),
  sifre: z.string().trim().min(1, 'Şifre zorunludur.')
})

export type LoginBody = z.infer<typeof loginBodySchema>

export const forgotPasswordBodySchema = z.object({
  identifier: z.string().trim().min(1, 'E-posta veya kullanıcı adı girin.')
})

export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>

export const resetPasswordBodySchema = z
  .object({
    token: z.string().trim().min(1, 'Sıfırlama anahtarı zorunludur.'),
    yeniSifre: z.string().min(8, 'Şifre en az 8 karakter olmalıdır.').max(200),
    yeniSifreTekrar: z.string().min(8, 'Şifre tekrarı en az 8 karakter olmalıdır.').max(200)
  })
  .refine((d) => d.yeniSifre === d.yeniSifreTekrar, {
    message: 'Şifreler eşleşmiyor.',
    path: ['yeniSifreTekrar']
  })

export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>

export const activateLicenseBodySchema = z.object({
  licenseKey: z.string().trim().min(1, 'Lisans anahtarı zorunludur.')
})

export type ActivateLicenseBody = z.infer<typeof activateLicenseBodySchema>

export const changeInitialPasswordBodySchema = z
  .object({
    yeniSifre: z.string().min(8, 'Şifre en az 8 karakter olmalıdır.').max(200),
    yeniSifreTekrar: z.string().min(8, 'Şifre tekrarı en az 8 karakter olmalıdır.').max(200)
  })
  .refine((d) => d.yeniSifre === d.yeniSifreTekrar, {
    message: 'Şifreler eşleşmiyor.',
    path: ['yeniSifreTekrar']
  })

export type ChangeInitialPasswordBody = z.infer<typeof changeInitialPasswordBodySchema>
