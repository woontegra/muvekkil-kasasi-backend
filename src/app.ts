import cors from 'cors'
import express from 'express'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import { requestLogger } from './middleware/requestLogger.js'
import healthRoutes from './routes/health.js'
import { apiV1Router } from './routes/apiV1.js'

export function createApp(): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(requestLogger)
  app.use(express.json({ limit: '1mb' }))
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true
    })
  )

  app.use('/', healthRoutes)
  app.use('/api/v1', apiV1Router)

  app.use(errorHandler)
  return app
}
