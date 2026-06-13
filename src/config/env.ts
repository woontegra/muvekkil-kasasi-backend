import { config } from 'dotenv'
import { z } from 'zod'

config()

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
  /** Şifre sıfırlama e-postasındaki link kökü; yoksa CORS_ORIGIN kullanılır. */
  PUBLIC_APP_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined),
    z.string().min(1).optional()
  )
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
      '  İsteğe bağlı: CORS_ORIGIN (frontend URL’iniz, örn. https://xxx.up.railway.app)\n' +
      '  İsteğe bağlı: PUBLIC_APP_URL (şifre sıfırlama linki; tanımlı değilse CORS_ORIGIN kullanılır)'
  )
  process.exit(1)
}

export const env: Env = parsed.data
