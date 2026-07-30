import rateLimit from 'express-rate-limit'
import type { Request, RequestHandler } from 'express'
import { env } from '../config/env.js'

/** Proxy arkasında X-Forwarded-For yalnızca güvenilir hop ile kullanılmalı (app.set('trust proxy')). */

/** Yerel E2E/smoke bataryaları production limitine takılmasın; prod sıkı kalır. */
const relaxAuthLimits =
  env.NODE_ENV !== 'production' && process.env.E2E_RELAX_RATE_LIMIT !== '0'

export const authLoginRateLimit: RequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: relaxAuthLimits ? 500 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.'
  }
})

export const authPasswordResetRateLimit: RequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: relaxAuthLimits ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.'
  }
})

export const adminLoginRateLimit: RequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: relaxAuthLimits ? 200 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.'
  }
})

export const authRefreshRateLimit: RequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: relaxAuthLimits ? 2000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.'
  }
})

export const webhookRateLimit: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'İstek limiti aşıldı.'
  }
})

export const manualSmsRateLimit: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: env.NODE_ENV === 'production' ? 8 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = (req as Request & { auth?: { tenantId?: string; sub?: string } }).auth
    return `${auth?.tenantId ?? 'anon'}:${auth?.sub ?? req.ip}`
  },
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'SMS gönderim isteği limiti aşıldı.'
  }
})
