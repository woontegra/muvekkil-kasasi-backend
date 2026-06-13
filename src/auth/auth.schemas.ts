import { z } from 'zod'

export const registerOfficeBodySchema = z.object({
  buroAdi: z.string().trim().min(2, 'Büro adı en az 2 karakter olmalıdır.'),
  adSoyad: z.string().trim().min(2, 'Ad soyad zorunludur.'),
  kullaniciAdi: z
    .string()
    .trim()
    .min(3, 'Kullanıcı adı en az 3 karakter olmalıdır.')
    .max(64)
    .transform((s) => s.toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9._-]+$/, 'Kullanıcı adı yalnızca küçük harf, rakam, . _ - içerebilir.')),
  eposta: z.string().trim().email('Geçerli bir e-posta girin.'),
  telefon: z.string().trim().min(3, 'Telefon zorunludur.').max(40),
  sifre: z.string().min(8, 'Şifre en az 8 karakter olmalıdır.').max(200)
})

export type RegisterOfficeBody = z.infer<typeof registerOfficeBodySchema>

export const loginBodySchema = z.object({
  identifier: z.string().trim().min(1, 'E-posta veya kullanıcı adı zorunludur.'),
  sifre: z.string().min(1, 'Şifre zorunludur.')
})

export type LoginBody = z.infer<typeof loginBodySchema>

export const forgotPasswordBodySchema = z.object({
  eposta: z.string().trim().email('Geçerli bir e-posta girin.')
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
