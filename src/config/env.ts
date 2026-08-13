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
  /** Access JWT ömrü — kısa tutulmalı (ör. 15m). */
  JWT_EXPIRES_IN: z.string().default('15m'),
  /** Woontegra süper admin JWT; production’da zorunlu. */
  ADMIN_JWT_SECRET: z.preprocess(
    (v) => (typeof v === 'string' && v.trim().length >= 16 ? v.trim() : undefined),
    z.string().min(16).optional()
  ),
  ADMIN_JWT_EXPIRES_IN: z.string().default('15m'),
  /** Virgülle ayrılmış izinli frontend origin listesi (credentials). */
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /** Refresh cookie / DB oturum süresi (gün). */
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  /** Cookie SameSite — çapraz site API için production’da none+secure gerekebilir. */
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
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
  /**
   * Yalnızca yerel geliştirmede SMTP yokken reset/aktivasyon linkini konsola yaz.
   * Railway / production’da asla açmayın — mail gitmeden 200 dönmesine yol açar.
   */
  MAIL_DEV_CONSOLE_FALLBACK: z.preprocess((v) => {
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase()
      if (t === 'true' || t === '1' || t === 'yes') return true
      if (t === 'false' || t === '0' || t === 'no') return false
    }
    return false
  }, z.boolean().default(false)),
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
  }, z.boolean().optional()),
  /** Meta Cloud API — false iken hiçbir gerçek dış WhatsApp API isteği yapılmaz. */
  WHATSAPP_CLOUD_API_ENABLED: z.preprocess((v) => {
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase()
      if (t === 'true' || t === '1' || t === 'yes') return true
      if (t === 'false' || t === '0' || t === 'no') return false
    }
    return false
  }, z.boolean().default(false)),
  /**
   * @deprecated Tenant gönderiminde kullanılmaz — yalnızca opsiyonel platform smoke test.
   * Tenant mesajları WhatsAppBaglanti üzerinden gider.
   */
  WHATSAPP_WABA_ID: optionalNonEmpty,
  /** @deprecated Tenant gönderiminde kullanılmaz — yalnızca opsiyonel platform smoke test. */
  WHATSAPP_PHONE_NUMBER_ID: optionalNonEmpty,
  /** @deprecated Tenant gönderiminde kullanılmaz — yalnızca opsiyonel platform smoke test. */
  WHATSAPP_ACCESS_TOKEN: optionalNonEmpty,
  /** Graph API sürümü (varsayılan v22.0; docs örnekleri v26.0 olabilir — env ile ayarlanır). */
  WHATSAPP_GRAPH_API_VERSION: z.preprocess(
    (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim().replace(/^\/+/, '') : undefined),
    z.string().min(1).optional()
  ),
  /** Meta / Facebook App ID — Embedded Signup (WHATSAPP_APP_ID tercih; META_APP_ID alias). */
  WHATSAPP_APP_ID: optionalNonEmpty,
  META_APP_ID: optionalNonEmpty,
  /** Embedded Signup config_id (FB.login). */
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: optionalNonEmpty,
  /** Tenant WABA webhook override hedefi (tam URL, örn. https://api.../api/webhooks/whatsapp). */
  WHATSAPP_WEBHOOK_PUBLIC_URL: optionalNonEmpty,
  /**
   * Tenant access token AES-256-GCM anahtarı (min 32 karakter).
   * Production bağlantıda zorunlu; non-prod’da yoksa JWT_SECRET’ten türetilir (uyarı).
   */
  WHATSAPP_TOKEN_ENCRYPTION_KEY: optionalNonEmpty,
  /**
   * Yalnızca SUPER_ADMIN isteğe bağlı outbound-test endpoint’inin ALICI numarası.
   * Import, worker, template gönderimi veya production kurulumu buna BAĞLI DEĞİLDİR.
   * Yoksa yalnızca outbound-test reddedilir; başka hiçbir akış CONFIG_MISSING vermez.
   */
  WHATSAPP_CLOUD_TEST_PHONE: optionalNonEmpty,
  /**
   * Woontegra dahili tenant mevcut-WABA import — tek zorunlu secret (System User token).
   * MailCenter tokenı kopyalanmaz; frontend’e dönmez / loglanmaz.
   */
  WHATSAPP_WOONTEGRA_SYSTEM_USER_TOKEN: optionalNonEmpty,
  /**
   * Yalnızca isteğe bağlı outbound-test / `whatsapp:cloud-test` template adı.
   * Production worker buna bağlı değildir.
   */
  WHATSAPP_CLOUD_TEST_TEMPLATE_NAME: optionalNonEmpty,
  /** Yalnızca isteğe bağlı outbound-test template dili (varsayılan en_US). */
  WHATSAPP_CLOUD_TEST_TEMPLATE_LANG: optionalNonEmpty,
  /** Otomatik WhatsApp hatırlatma planlama/worker — Meta onayı öncesi false. */
  WHATSAPP_AUTOMATION_ENABLED: z.preprocess((v) => {
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase()
      if (t === 'true' || t === '1' || t === 'yes') return true
      if (t === 'false' || t === '0' || t === 'no') return false
    }
    return false
  }, z.boolean().default(false)),
  WHATSAPP_WEBHOOK_ENABLED: z.preprocess((v) => {
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase()
      if (t === 'true' || t === '1' || t === 'yes') return true
      if (t === 'false' || t === '0' || t === 'no') return false
    }
    return false
  }, z.boolean().default(false)),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: optionalNonEmpty,
  WHATSAPP_APP_SECRET: optionalNonEmpty,
  /** @deprecated SMS/Netgsm kaldırıldı — yalnızca eski dosya derlemesi için opsiyonel. */
  NETGSM_ENABLED: z.preprocess(() => false, z.boolean().default(false)),
  NETGSM_USERNAME: optionalNonEmpty,
  NETGSM_PASSWORD: optionalNonEmpty,
  NETGSM_ORIGINATOR: optionalNonEmpty,
  NETGSM_TEST_SMS_ENABLED: z.preprocess(() => false, z.boolean().default(false))
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
      '  - ADMIN_JWT_SECRET → production’da zorunlu, JWT_SECRET’ten ayrı\n' +
      '  İsteğe bağlı: CORS_ORIGIN / FRONTEND_URL (frontend URL’iniz)\n' +
      '  İsteğe bağlı: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (genel SMTP)\n' +
      '  veya: GMAIL_USER + GMAIL_APP_PASSWORD (Gmail kolay kurulum)'
  )
  process.exit(1)
}

export const env: Env = parsed.data

if (env.NODE_ENV === 'production' && !env.ADMIN_JWT_SECRET) {
  console.error('[env] Production’da ADMIN_JWT_SECRET zorunludur (JWT_SECRET fallback kapalı).')
  process.exit(1)
}

if (
  env.NODE_ENV === 'production' &&
  env.ADMIN_JWT_SECRET &&
  env.ADMIN_JWT_SECRET === env.JWT_SECRET
) {
  console.error('[env] Production’da ADMIN_JWT_SECRET, JWT_SECRET ile aynı olamaz.')
  process.exit(1)
}

if (env.COOKIE_SAME_SITE === 'none' && env.NODE_ENV === 'production') {
  // Secure cookie zorunlu — sessionCookies zaten production’da secure=true
}

if (env.WHATSAPP_CLOUD_API_ENABLED && env.NODE_ENV === 'production') {
  // Cloud API prod’da flag açık olsa bile secret/config yoksa worker gerçek istek atmaz (provider NOT_CONFIGURED).
  console.warn('[env] WHATSAPP_CLOUD_API_ENABLED=true — Meta hesap/secret yapılandırması tamamlanmadan gönderim yapılmaz.')
}

/** Embedded Signup / Graph app id — WHATSAPP_APP_ID tercih, META_APP_ID alias. */
export function resolveWhatsAppAppId(): string | undefined {
  return env.WHATSAPP_APP_ID ?? env.META_APP_ID
}

/** Graph API version — varsayılan v22.0. */
export function resolveWhatsAppGraphVersion(): string {
  return env.WHATSAPP_GRAPH_API_VERSION?.trim() || 'v22.0'
}

export function getActivationTokenExpiresHours(): number {
  return env.ACTIVATION_TOKEN_EXPIRES_HOURS
}

export function adminJwtSecretResolved(): string {
  if (env.ADMIN_JWT_SECRET) return env.ADMIN_JWT_SECRET
  if (env.NODE_ENV === 'production') {
    throw new Error('ADMIN_JWT_SECRET production’da zorunlu')
  }
  return env.JWT_SECRET
}
