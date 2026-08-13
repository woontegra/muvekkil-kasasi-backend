import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { getAllowedOrigins } from './config/allowedOrigins.js'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import { requestLogger } from './middleware/requestLogger.js'
import { securityHeaders } from './middleware/securityHeaders.js'
import healthRoutes from './routes/health.js'
import { apiV1Router } from './routes/apiV1.js'
import { whatsappWebhookRouter } from './tahsilatBildirim/webhook.routes.js'

function whatsappRawBodyJson() {
  return express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      ;(req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf)
    }
  })
}

export function createApp(): express.Express {
  const app = express()
  app.disable('x-powered-by')

  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1)
  }

  app.use(securityHeaders)
  app.use(requestLogger)
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  // Preferred public webhook path + legacy integrations path (HMAC raw body)
  app.use('/api/webhooks/whatsapp', whatsappRawBodyJson())
  app.use('/api/v1/integrations/whatsapp', whatsappRawBodyJson())
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  const origins = getAllowedOrigins()
  if (origins.length === 0) {
    throw new Error('CORS_ORIGIN/FRONTEND_URL boş; bilinen frontend origin tanımlayın.')
  }
  app.use(
    cors({
      origin: origins.length === 1 ? origins[0]! : origins,
      credentials: true
    })
  )

  app.use('/', healthRoutes)
  app.use('/api/webhooks/whatsapp', whatsappWebhookRouter)
  app.use('/api/v1', apiV1Router)

  app.use('/api', (_req, res) => {
    res.status(404).json({
      ok: false,
      code: 'NOT_FOUND',
      message: 'İlgili API endpointi bulunamadı.'
    })
  })

  app.use(errorHandler)
  return app
}
