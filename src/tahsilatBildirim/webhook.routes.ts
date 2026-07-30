import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { env } from '../config/env.js'
import { webhookRateLimit } from '../middleware/rateLimits.js'

/**
 * Meta WhatsApp webhook iskeleti.
 * Faz 1: WHATSAPP_WEBHOOK_ENABLED !== 'true' ise 404.
 * POST: imza zorunlu ve HMAC doğrulanmadan olay işlenmez; doğrulansa bile Faz 2’ye kadar 501.
 */
export const whatsappWebhookRouter = Router()

type ReqWithRaw = Request & { rawBody?: Buffer }

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

function webhookEnabled(): boolean {
  return env.WHATSAPP_WEBHOOK_ENABLED === true
}

function notEnabled(res: Response): void {
  res.status(404).json({ ok: false, code: 'NOT_ENABLED' })
}

function verifyMetaSignature(rawBody: Buffer | undefined, signatureHeader: string, appSecret: string): boolean {
  if (!rawBody || rawBody.length === 0) return false
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader.trim())
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

whatsappWebhookRouter.get(
  '/webhook',
  webhookRateLimit,
  asyncHandler(async (req, res) => {
    if (!webhookEnabled()) {
      notEnabled(res)
      return
    }

    const mode = typeof req.query['hub.mode'] === 'string' ? req.query['hub.mode'] : ''
    const token = typeof req.query['hub.verify_token'] === 'string' ? req.query['hub.verify_token'] : ''
    const challenge =
      typeof req.query['hub.challenge'] === 'string' ? req.query['hub.challenge'] : ''
    const expected = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? ''

    if (mode === 'subscribe' && expected.length > 0 && token === expected && challenge) {
      res.status(200).type('text/plain').send(challenge)
      return
    }

    res.status(403).json({
      ok: false,
      code: 'VERIFY_FAILED',
      message: 'Webhook doğrulama başarısız veya yapılandırılmamış.'
    })
  })
)

whatsappWebhookRouter.post(
  '/webhook',
  webhookRateLimit,
  asyncHandler(async (req, res) => {
    if (!webhookEnabled()) {
      notEnabled(res)
      return
    }

    const signature = req.header('x-hub-signature-256')
    if (!signature) {
      res.status(401).json({
        ok: false,
        code: 'SIGNATURE_REQUIRED',
        message: 'İmza başlığı zorunludur; imzasız webhook kabul edilmez.'
      })
      return
    }

    const appSecret = env.WHATSAPP_APP_SECRET ?? ''
    if (!appSecret) {
      res.status(503).json({
        ok: false,
        code: 'NOT_CONFIGURED',
        message: 'WhatsApp webhook imza doğrulaması yapılandırılmamış.'
      })
      return
    }

    const rawBody = (req as ReqWithRaw).rawBody
    if (!verifyMetaSignature(rawBody, signature, appSecret)) {
      res.status(401).json({
        ok: false,
        code: 'SIGNATURE_INVALID',
        message: 'Webhook imzası geçersiz.'
      })
      return
    }

    // İmza geçerli olsa bile olay işlenmez (Faz 2). Body/telefon/mesaj loglanmaz.
    res.status(501).json({
      ok: false,
      code: 'NOT_IMPLEMENTED',
      message: 'WhatsApp webhook işleme Faz 2 için bekliyor; olay işlenmedi.'
    })
  })
)
