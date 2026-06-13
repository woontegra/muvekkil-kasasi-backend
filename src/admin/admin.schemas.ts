import { z } from 'zod'

export const adminLoginBodySchema = z.object({
  identifier: z.string().min(1, 'Kullanıcı adı veya e-posta gerekli.'),
  sifre: z.string().min(1, 'Şifre gerekli.')
})

export type AdminLoginBody = z.infer<typeof adminLoginBodySchema>

/** Lisans uzatma: ya `miktar`+`birim`, ya `bitisTarihi`, ya (legacy) `aySayisi` | `yilSayisi` — aynı anda birden fazlası olamaz. */
export const adminExtendLicenseBodySchema = z
  .object({
    miktar: z.coerce.number().int().min(1).optional(),
    birim: z.enum(['GUN', 'AY', 'YIL']).optional(),
    bitisTarihi: z.coerce.date().optional(),
    demoMu: z.boolean().optional(),
    aciklama: z.string().trim().max(2000).optional(),
    aySayisi: z.coerce.number().int().min(1).max(120).optional(),
    yilSayisi: z.coerce.number().int().min(1).max(10).optional()
  })
  .strict()
  .superRefine((b, ctx) => {
    const hasPair = b.miktar != null && b.birim != null
    const hasDate = b.bitisTarihi != null
    const legacyAy = b.aySayisi != null && b.yilSayisi == null
    const legacyYil = b.yilSayisi != null && b.aySayisi == null
    const legacy = legacyAy || legacyYil
    const modes = [hasPair, hasDate, legacy].filter(Boolean)
    if (modes.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Gövde: ya { miktar, birim }, ya { bitisTarihi }, ya (legacy) aySayisi veya yilSayisi — ikisini birden göndermeyin; biri zorunlu.'
      })
      return
    }
    if (hasPair) {
      const m = b.miktar!
      if (b.birim === 'GUN' && m > 3650) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Gün en fazla 3650.', path: ['miktar'] })
      if (b.birim === 'AY' && m > 120) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ay en fazla 120.', path: ['miktar'] })
      if (b.birim === 'YIL' && m > 10) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Yıl en fazla 10.', path: ['miktar'] })
    }
  })

const tenantOwnerKullaniciAdiSchema = z
  .string()
  .trim()
  .min(3, 'Kullanıcı adı en az 3 karakter.')
  .max(64)
  .transform((s) => s.toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9._-]+$/, 'Kullanıcı adı yalnızca küçük harf, rakam, . _ - içerebilir.'))

/** JSON bazen `null` gönderir; `undefined` ile eşle. */
function jsonNullToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v: unknown) => (v === null ? undefined : v), schema)
}

/** Woontegra admin panelinden manuel büro + ilk büro sahibi oluşturma (yalnız SUPER_ADMIN). */
export const adminCreateTenantBodySchema = z
  .object({
    buroAdi: z.string().trim().min(1, 'Büro adı zorunlu.').max(500),
    telefon: jsonNullToUndefined(z.string().trim().max(80).optional().default('')),
    eposta: jsonNullToUndefined(z.string().trim().max(320).optional()),
    adres: jsonNullToUndefined(z.string().trim().max(4000).optional().default('')),
    vergiNo: jsonNullToUndefined(z.string().trim().max(64).optional().default('')),
    vergiDairesi: jsonNullToUndefined(z.string().trim().max(200).optional().default('')),
    ownerAdSoyad: z.string().trim().min(1, 'Ad soyad zorunlu.').max(300),
    ownerKullaniciAdi: tenantOwnerKullaniciAdiSchema,
    ownerEposta: jsonNullToUndefined(z.string().trim().max(320).optional()),
    ownerTelefon: jsonNullToUndefined(z.string().trim().max(80).optional().default('')),
    ownerSifre: z.string().min(8, 'Şifre en az 8 karakter.').max(200),
    lisansTipi: z.enum(['DEMO', 'AKTIF']),
    lisansSuresiMiktar: z.coerce.number().int().min(1),
    lisansSuresiBirim: z.enum(['GUN', 'AY', 'YIL']),
    yillikUcret: jsonNullToUndefined(z.coerce.number().finite().nonnegative().nullable().optional()),
    notlar: jsonNullToUndefined(z.string().trim().max(8000).optional())
  })
  .strict()
  .superRefine((b, ctx) => {
    const m = b.lisansSuresiMiktar
    if (b.lisansSuresiBirim === 'GUN' && m > 3650) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Gün en fazla 3650.', path: ['lisansSuresiMiktar'] })
    }
    if (b.lisansSuresiBirim === 'AY' && m > 120) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ay en fazla 120.', path: ['lisansSuresiMiktar'] })
    }
    if (b.lisansSuresiBirim === 'YIL' && m > 10) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Yıl en fazla 10.', path: ['lisansSuresiMiktar'] })
    }
    const te = b.eposta?.trim()
    if (te && !z.string().email().safeParse(te).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Geçerli büro e-postası girin.', path: ['eposta'] })
    }
    const oe = b.ownerEposta?.trim()
    if (oe && !z.string().email().safeParse(oe).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Geçerli sahip e-postası girin.', path: ['ownerEposta'] })
    }
  })

export type AdminCreateTenantBody = z.infer<typeof adminCreateTenantBodySchema>

export const adminTenantUpdateBodySchema = z.object({
  buroAdi: z.string().trim().min(1).max(500).optional(),
  telefon: z.string().trim().max(80).nullable().optional(),
  eposta: z.string().trim().email().max(320).nullable().optional(),
  adres: z.string().trim().max(4000).nullable().optional(),
  vergiNo: z.string().trim().max(64).nullable().optional(),
  vergiDairesi: z.string().trim().max(200).nullable().optional(),
  aktifMi: z.boolean().optional(),
  lisansDurumu: z.enum(['DEMO', 'AKTIF', 'SURESI_DOLDU', 'PASIF']).optional(),
  lisansBaslangicTarihi: z.coerce.date().nullable().optional(),
  lisansBitisTarihi: z.coerce.date().nullable().optional(),
  demoMu: z.boolean().optional(),
  demoBitisTarihi: z.coerce.date().nullable().optional(),
  sonOdemeTarihi: z.coerce.date().nullable().optional(),
  yillikUcret: z.coerce.number().finite().nonnegative().nullable().optional(),
  lisansNotlari: z.string().trim().max(8000).nullable().optional()
})

export const adminUserUpdateBodySchema = z.object({
  tenantId: z.string().uuid(),
  adSoyad: z.string().trim().min(1).max(300).optional(),
  eposta: z.string().trim().email().max(320).nullable().optional(),
  telefon: z.string().trim().max(80).nullable().optional(),
  rol: z.enum(['BURO_SAHIBI', 'AVUKAT_YONETICI', 'KATIP_PERSONEL']).optional(),
  aktifMi: z.boolean().optional()
})

export const adminResetPasswordBodySchema = z.object({
  yeniSifre: z.string().min(8, 'Şifre en az 8 karakter.').max(200).optional()
})

const kullaniciAdiSchema = z
  .string()
  .trim()
  .min(2, 'Kullanıcı adı en az 2 karakter.')
  .max(80)
  .regex(/^[a-z0-9._-]+$/i, 'Yalnız harf, rakam, nokta, alt çizgi ve tire.')

export const adminSuperAdminCreateSchema = z.object({
  adSoyad: z.string().trim().min(1).max(300),
  kullaniciAdi: kullaniciAdiSchema,
  eposta: z.string().trim().email().max(320).nullable().optional(),
  sifre: z.string().min(8, 'Şifre en az 8 karakter.').max(200),
  rol: z.enum(['SUPER_ADMIN', 'DESTEK', 'FINANS'])
})

export const adminSuperAdminUpdateSchema = z.object({
  adSoyad: z.string().trim().min(1).max(300).optional(),
  eposta: z.string().trim().email().max(320).nullable().optional(),
  rol: z.enum(['SUPER_ADMIN', 'DESTEK', 'FINANS']).optional(),
  aktifMi: z.boolean().optional()
})

export const adminSuperAdminResetPasswordBodySchema = z.object({
  yeniSifre: z.string().min(8, 'Şifre en az 8 karakter.').max(200).optional()
})

export const adminProfileUpdateSchema = z.object({
  adSoyad: z.string().trim().min(1).max(300).optional(),
  eposta: z.string().trim().email().max(320).nullable().optional()
})

export const adminSelfChangePasswordSchema = z
  .object({
    mevcutSifre: z.string().min(1, 'Mevcut şifre gerekli.'),
    yeniSifre: z.string().min(8, 'Yeni şifre en az 8 karakter.').max(200),
    yeniSifreTekrar: z.string().min(8).max(200)
  })
  .refine((b) => b.yeniSifre === b.yeniSifreTekrar, {
    message: 'Yeni şifre ile tekrarı eşleşmiyor.',
    path: ['yeniSifreTekrar']
  })
