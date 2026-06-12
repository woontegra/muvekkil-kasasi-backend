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
  sifre: z.string().min(6, 'Şifre en az 6 karakter olmalıdır.').max(200)
})

export type RegisterOfficeBody = z.infer<typeof registerOfficeBodySchema>

export const loginBodySchema = z
  .object({
    epostaVeyaKullaniciAdi: z.string().trim().min(1, 'E-posta veya kullanıcı adı zorunludur.'),
    tenantSlug: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((s) => (s && s.length > 0 ? s : undefined)),
    sifre: z.string().min(1, 'Şifre zorunludur.')
  })
  .superRefine((data, ctx) => {
    const id = data.epostaVeyaKullaniciAdi
    const isEmail = id.includes('@')
    if (!isEmail && (!data.tenantSlug || data.tenantSlug.length < 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Kullanıcı adı ile giriş için büro kodu (tenantSlug) zorunludur.',
        path: ['tenantSlug']
      })
    }
  })

export type LoginBody = z.infer<typeof loginBodySchema>
