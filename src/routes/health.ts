import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { env } from '../config/env.js'

const r = Router()

r.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ ok: true, db: 'up' })
  } catch {
    res.status(503).json({
      ok: false,
      db: 'down',
      message: env.NODE_ENV === 'production' ? 'Veritabanı kullanılamıyor.' : 'Veritabanı bağlantısı başarısız.'
    })
  }
})

r.get('/health/live', (_req, res) => {
  res.json({ ok: true })
})

export default r
