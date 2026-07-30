import { env } from '../config/env.js'

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
  return [...set]
}
