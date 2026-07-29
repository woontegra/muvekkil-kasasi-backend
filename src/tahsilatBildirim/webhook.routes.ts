import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'

/**
 * Meta WhatsApp webhook iskeleti.
 * Faz 1: WHATSAPP_WEBHOOK_ENABLED !== 'true' ise 404.
 * İmzasız istekler reddedilir; gerçek Cloud API işleme yok.
 */
export const whatsappWebhookRouter = Router()

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

function webhookEnabled(): boolean {
  return process.env.WHATSAPP_WEBHOOK_ENABLED === 'true'
}

function notEnabled(res: Response): void {
  res.status(404).json({ ok: false, code: 'NOT_ENABLED' })
}

whatsappWebhookRouter.get(
  '/webhook',
  asyncHandler(async (req, res) => {
    if (!webhookEnabled()) {
      notEnabled(res)
      return
    }

    // Meta hub.challenge doğrulama iskeleti — verify token env yoksa reddet.
    const mode = typeof req.query['hub.mode'] === 'string' ? req.query['hub.mode'] : ''
    const token = typeof req.query['hub.verify_token'] === 'string' ? req.query['hub.verify_token'] : ''
    const challenge =
      typeof req.query['hub.challenge'] === 'string' ? req.query['hub.challenge'] : ''
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? ''

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

    // Faz 1: imza doğrulama stub — gerçek işleme yok, sahte başarı yok.
    const appSecret = process.env.WHATSAPP_APP_SECRET ?? ''
    if (!appSecret) {
      res.status(503).json({
        ok: false,
        code: 'NOT_CONFIGURED',
        message: 'WhatsApp webhook imza doğrulaması yapılandırılmamış.'
      })
      return
    }

    res.status(501).json({
      ok: false,
      code: 'NOT_IMPLEMENTED',
      message: 'WhatsApp webhook işleme Faz 2 için bekliyor; olay işlenmedi.'
    })
  })
)
