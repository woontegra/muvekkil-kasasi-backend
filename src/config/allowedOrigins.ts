import { env } from '../config/env.js'

/**
 * Bilinen production frontend origin’leri.
 * Railway Variables’ta CORS_ORIGIN/FRONTEND_URL eksik/yanlış olsa bile
 * canlı Vercel uygulaması ve dokümante custom domain cookie endpoint’lerinde
 * ORIGIN_FORBIDDEN olmasın (tam eşleşme; wildcard yok).
 */
const KNOWN_PRODUCTION_FRONTEND_ORIGINS = [
  'https://muvekkil.woontegra.com',
  'https://muvekkil-kasasi-frontend.vercel.app',
  'https://app.muvekkilkasasi.com'
] as const

function originFromUrl(raw: string | undefined): string | null {
  const v = raw?.trim()
  if (!v) return null
  try {
    return new URL(v).origin
  } catch {
    return null
  }
}

/** CORS + trusted Origin için izinli origin listesi (tam eşleşme). */
export function getAllowedOrigins(): string[] {
  const set = new Set<string>()
  for (const part of env.CORS_ORIGIN.split(',')) {
    const o = part.trim()
    if (o && o !== '*') set.add(o)
  }
  for (const candidate of [env.FRONTEND_URL, env.PUBLIC_APP_URL]) {
    const o = originFromUrl(candidate)
    if (o) set.add(o)
  }
  if (env.NODE_ENV === 'production') {
    for (const o of KNOWN_PRODUCTION_FRONTEND_ORIGINS) set.add(o)
  }
  return [...set]
}
