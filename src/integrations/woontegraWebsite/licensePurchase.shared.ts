import { createHash } from 'node:crypto'

export function hashLicensePurchaseToken(plainToken: string): string {
  return createHash('sha256').update(plainToken.trim(), 'utf8').digest('hex')
}

export function woontegraWebsiteCheckoutBase(): string {
  const fromEnv = process.env.WOONTEGRA_WEBSITE_URL?.trim()
  const base = (fromEnv || 'https://www.woontegra.com').replace(/\/$/, '')
  return `${base}/yazilimlar/muvekkil-kasa-defteri-web-tabanli`
}
