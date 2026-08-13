import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
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
    const ipKey = req.ip ? ipKeyGenerator(req.ip) : 'no-ip'
    return `${auth?.tenantId ?? 'anon'}:${auth?.sub ?? ipKey}`
  },
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'SMS gönderim isteği limiti aşıldı.'
  }
})

/** SUPER_ADMIN WhatsApp outbound test — dakikada az deneme. */
export const adminWhatsAppOutboundTestRateLimit: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: env.NODE_ENV === 'production' ? 3 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const admin = (req as Request & { adminAuth?: { sub?: string } }).adminAuth
    const ipKey = req.ip ? ipKeyGenerator(req.ip) : 'no-ip'
    return `wa-out-test:${admin?.sub ?? ipKey}`
  },
  message: {
    ok: false,
    code: 'RATE_LIMITED',
    message: 'WhatsApp test gönderim limiti aşıldı.'
  }
})
