import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { env } from '../config/env.js'
import { webhookRateLimit } from '../middleware/rateLimits.js'
import { processWhatsAppWebhookPayload, type MetaWebhookPayload } from './webhook.processor.js'

/**
 * Meta WhatsApp webhook.
 * Mounts:
 *  - /api/webhooks/whatsapp  (preferred public) → GET/POST /
 *  - /api/v1/integrations/whatsapp → GET/POST /webhook (legacy)
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

export function verifyMetaSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string,
  appSecret: string
): boolean {
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

async function handleVerify(req: Request, res: Response): Promise<void> {
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
}

async function handlePost(req: Request, res: Response): Promise<void> {
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

  // Meta’ya hızlı 200; body/telefon loglanmaz.
  const payload = (req.body ?? {}) as MetaWebhookPayload
  try {
    await processWhatsAppWebhookPayload(payload)
  } catch {
    // İşleme hatası Meta retry’ı tetiklemesin diye yine 200
  }

  res.status(200).json({ ok: true })
}

// Preferred public mount: /api/webhooks/whatsapp
whatsappWebhookRouter.get('/', webhookRateLimit, asyncHandler(handleVerify))
whatsappWebhookRouter.post('/', webhookRateLimit, asyncHandler(handlePost))

// Legacy mount: /api/v1/integrations/whatsapp/webhook
whatsappWebhookRouter.get('/webhook', webhookRateLimit, asyncHandler(handleVerify))
whatsappWebhookRouter.post('/webhook', webhookRateLimit, asyncHandler(handlePost))
