import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { env } from '../config/env.js'

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      ok: false,
      error: 'VALIDATION_ERROR',
      message: 'İstek gövdesi doğrulanamadı.',
      details: err.flatten()
    })
    return
  }
  if (err instanceof AppError) {
    const code = err.code ?? 'APP_ERROR'
    res.status(err.statusCode).json({
      ok: false,
      error: code,
      code,
      message: err.message
    })
    return
  }
  // eslint-disable-next-line no-console
  console.error('[errorHandler]', err)
  res.status(500).json({
    ok: false,
    error: 'INTERNAL_ERROR',
    message: env.NODE_ENV === 'production' ? 'Sunucu hatası' : String(err?.message ?? err)
  })
}
