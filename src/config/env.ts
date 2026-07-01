import { config } from 'dotenv'
import { z } from 'zod'

config()

const optionalNonEmpty = z.preprocess(
  (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined),
  z.string().min(1).optional()
)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET en az 16 karakter olmalı'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  /** Woontegra süper admin JWT; yoksa JWT_SECRET kullanılır (payload `typ: admin` zorunlu). */
  ADMIN_JWT_SECRET: z.preprocess(
    (v) => (typeof v === 'string' && v.trim().length >= 16 ? v.trim() : undefined),
    z.string().min(16).optional()
  ),
  ADMIN_JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /** Şifre sıfırlama e-postasındaki link kökü; yoksa FRONTEND_URL / CORS_ORIGIN kullanılır. */
  PUBLIC_APP_URL: optionalNonEmpty,
  FRONTEND_URL: optionalNonEmpty,
  APP_URL: optionalNonEmpty,
  /** Tam kök URL veya /reset-password yolu içerebilir; token otomatik eklenir. */
  RESET_PASSWORD_URL: optionalNonEmpty,
  SMTP_HOST: optionalNonEmpty,
  SMTP_PORT: optionalNonEmpty,
  SMTP_USER: optionalNonEmpty,
  SMTP_PASS: optionalNonEmpty,
  SMTP_FROM: optionalNonEmpty,
  MAIL_FROM: optionalNonEmpty,
  MAIL_USER: optionalNonEmpty,
  DEFAULT_MAIL_USER: optionalNonEmpty,
  GMAIL_USER: optionalNonEmpty,
  GMAIL_APP_PASSWORD: optionalNonEmpty,
  /** Woontegra Website ödeme sonrası tenant/büro oluşturma entegrasyonu (server-to-server). */
  WOONTEGRA_WEBSITE_PROVISION_SECRET: z.preprocess(
    (v) => (typeof v === 'string' && v.trim().length >= 16 ? v.trim() : undefined),
    z.string().min(16).optional()
  ),
  /** Hoş geldiniz aktivasyon token süresi (saat). */
  ACTIVATION_TOKEN_EXPIRES_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  SMTP_SECURE: z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase()
      if (t === 'true' || t === '1' || t === 'yes') return true
      if (t === 'false' || t === '0' || t === 'no') return false
    }
    return Boolean(v)
  }, z.boolean().optional())
})

export type Env = z.infer<typeof envSchema>

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
  console.error('[env] Geçersiz veya eksik ortam değişkenleri:', keys)
  console.error(
    '[env] Railway: Project → servisiniz → Variables bölümünde en az şunları tanımlayın:\n' +
      '  - DATABASE_URL  → PostgreSQL eklentisini servise bağlayın veya Postgres’in verdiği URL’yi yapıştırın\n' +
      '  - JWT_SECRET    → en az 16 karakter güçlü rastgele dize (örn. openssl rand -hex 32)\n' +
      '  İsteğe bağlı: CORS_ORIGIN / FRONTEND_URL (frontend URL’iniz)\n' +
      '  İsteğe bağlı: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (genel SMTP)\n' +
      '  veya: GMAIL_USER + GMAIL_APP_PASSWORD (Gmail kolay kurulum)'
  )
  process.exit(1)
}

export const env: Env = parsed.data

export function getActivationTokenExpiresHours(): number {
  return env.ACTIVATION_TOKEN_EXPIRES_HOURS
}
