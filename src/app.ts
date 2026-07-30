import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import { requestLogger } from './middleware/requestLogger.js'
import { securityHeaders } from './middleware/securityHeaders.js'
import healthRoutes from './routes/health.js'
import { apiV1Router } from './routes/apiV1.js'

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

  app.use(
    '/api/v1/integrations/whatsapp',
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        ;(req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf)
      }
    })
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  const origins = env.CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (origins.includes('*') || origins.length === 0) {
    throw new Error('CORS_ORIGIN=* credentials ile kullanılamaz; bilinen frontend origin tanımlayın.')
  }
  app.use(
    cors({
      origin: origins.length === 1 ? origins[0]! : origins,
      credentials: true
    })
  )

  app.use('/', healthRoutes)
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
