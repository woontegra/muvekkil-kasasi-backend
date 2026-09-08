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

function isPrismaLikeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; code?: string; message?: unknown; clientVersion?: unknown }
  if (typeof e.name === 'string' && e.name.startsWith('Prisma')) return true
  if (typeof e.code === 'string' && /^P\d{4}$/.test(e.code)) return true
  if (e.clientVersion != null) return true
  const msg = String(e.message ?? '')
  return /Unknown argument|Invalid `prisma\.|prisma\./i.test(msg)
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

  const errMessage = String((err as { message?: unknown })?.message ?? err)
  const isDbUnreachable =
    (err as { errorCode?: string })?.errorCode === 'P1001' ||
    /Can't reach database server|P1001|ECONNREFUSED.*5432/i.test(errMessage)

  if (isDbUnreachable) {
    res.status(503).json({
      ok: false,
      error: 'DATABASE_UNAVAILABLE',
      message:
        env.NODE_ENV === 'production'
          ? 'Veritabanına şu an ulaşılamıyor.'
          : 'Veritabanına ulaşılamıyor. DATABASE_URL ve PostgreSQL bağlantısını kontrol edin.'
    })
    return
  }

  if (isPrismaLikeError(err)) {
    res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: 'Bildirim ayarları şu an yüklenemedi. Lütfen daha sonra tekrar deneyin.'
    })
    return
  }

  res.status(500).json({
    ok: false,
    error: 'INTERNAL_ERROR',
    message: env.NODE_ENV === 'production' ? 'Sunucu hatası' : 'Beklenmeyen bir sunucu hatası oluştu.'
  })
}
