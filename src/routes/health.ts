import { Router } from 'express'
import { prisma } from '../lib/prisma.js'

const r = Router()

r.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ ok: true, db: 'up' })
  } catch (e) {
    res.status(503).json({ ok: false, db: 'down', message: String(e) })
  }
})

r.get('/health/live', (_req, res) => {
  res.json({ ok: true })
})

export default r
