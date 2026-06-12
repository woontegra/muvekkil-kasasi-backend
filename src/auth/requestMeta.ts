import type { Request } from 'express'

export function getRequestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const xf = req.headers['x-forwarded-for']
  const fromHeader = typeof xf === 'string' ? xf.split(',')[0]?.trim() : Array.isArray(xf) ? xf[0] : null
  const ip = (fromHeader || req.socket.remoteAddress || null) as string | null
  const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null
  return { ipAddress: ip, userAgent: ua }
}
