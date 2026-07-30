import type { Response } from 'express'
import { env } from '../config/env.js'

export const TENANT_REFRESH_COOKIE = 'mkd_rt'
export const ADMIN_REFRESH_COOKIE = 'mkd_admin_rt'

export function cookieSecure(): boolean {
  return env.NODE_ENV === 'production'
}

export function cookieSameSite(): 'lax' | 'strict' | 'none' {
  return env.COOKIE_SAME_SITE
}

function refreshMaxAgeMs(): number {
  return env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000
}

export function setTenantRefreshCookie(res: Response, plainToken: string): void {
  res.cookie(TENANT_REFRESH_COOKIE, plainToken, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: cookieSameSite(),
    path: '/api/v1/auth',
    maxAge: refreshMaxAgeMs()
  })
}

export function clearTenantRefreshCookie(res: Response): void {
  res.clearCookie(TENANT_REFRESH_COOKIE, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: cookieSameSite(),
    path: '/api/v1/auth'
  })
}

export function setAdminRefreshCookie(res: Response, plainToken: string): void {
  res.cookie(ADMIN_REFRESH_COOKIE, plainToken, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: cookieSameSite(),
    path: '/api/v1/admin/auth',
    maxAge: refreshMaxAgeMs()
  })
}

export function clearAdminRefreshCookie(res: Response): void {
  res.clearCookie(ADMIN_REFRESH_COOKIE, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: cookieSameSite(),
    path: '/api/v1/admin/auth'
  })
}

export { refreshMaxAgeMs }
