import { env } from '../config/env.js'

export type MailEnvInput = {
  SMTP_HOST?: string
  SMTP_PORT?: string
  SMTP_USER?: string
  SMTP_PASS?: string
  SMTP_FROM?: string
  MAIL_FROM?: string
  SMTP_SECURE?: boolean
  GMAIL_USER?: string
  GMAIL_APP_PASSWORD?: string
  MAIL_USER?: string
  DEFAULT_MAIL_USER?: string
}

export type ResolvedMailTransport = {
  configured: boolean
  source: 'smtp' | 'gmail' | null
  missing: string[]
  /** GMAIL_APP_PASSWORD var ama gönderen kullanıcı çözülemedi */
  gmailUserMissing: boolean
  host?: string
  port?: number
  secure: boolean
  authUser?: string
  authPass?: string
  from?: string
}

function optionalTrim(v: string | undefined): string | undefined {
  const t = v?.trim()
  return t ? t : undefined
}

function resolveMailUser(input: MailEnvInput): string | undefined {
  return (
    optionalTrim(input.GMAIL_USER) ??
    optionalTrim(input.MAIL_USER) ??
    optionalTrim(input.SMTP_USER) ??
    optionalTrim(input.DEFAULT_MAIL_USER)
  )
}

function resolveFromAddress(input: MailEnvInput, authUser?: string): string | undefined {
  return optionalTrim(input.MAIL_FROM) ?? optionalTrim(input.SMTP_FROM) ?? (authUser ? `Müvekkil Kasa Defteri <${authUser}>` : undefined)
}

function hasExplicitSmtp(input: MailEnvInput): boolean {
  return !!(optionalTrim(input.SMTP_HOST) && optionalTrim(input.SMTP_USER) && optionalTrim(input.SMTP_PASS))
}

/** Gmail uygulama şifresindeki boşlukları temizler. */
function normalizeGmailAppPassword(raw: string): string {
  return raw.replace(/\s+/g, '')
}

/**
 * Mail taşıyıcı yapılandırması.
 * Öncelik: (A) SMTP_HOST+SMTP_USER+SMTP_PASS → (B) GMAIL_APP_PASSWORD
 */
export function resolveMailTransport(input: MailEnvInput): ResolvedMailTransport {
  const gmailPassRaw = optionalTrim(input.GMAIL_APP_PASSWORD)
  const gmailUserMissing = !!gmailPassRaw && !resolveMailUser(input)

  if (hasExplicitSmtp(input)) {
    const host = optionalTrim(input.SMTP_HOST)!
    const user = optionalTrim(input.SMTP_USER)!
    const pass = optionalTrim(input.SMTP_PASS)!
    const portRaw = optionalTrim(input.SMTP_PORT)
    const port = portRaw ? Number(portRaw) : 587
    const secure = input.SMTP_SECURE ?? port === 465
    const from = resolveFromAddress(input, user)

    const missing: string[] = []
    if (Number.isNaN(port)) missing.push('SMTP_PORT (geçersiz)')
    if (!from) missing.push('MAIL_FROM veya SMTP_FROM')

    return {
      configured: missing.length === 0 && !Number.isNaN(port),
      source: 'smtp',
      missing,
      gmailUserMissing: false,
      host,
      port: Number.isNaN(port) ? undefined : port,
      secure,
      authUser: user,
      authPass: pass,
      from
    }
  }

  if (gmailPassRaw) {
    const user = resolveMailUser(input)
    if (!user) {
      return {
        configured: false,
        source: null,
        missing: ['GMAIL_USER veya SMTP_USER veya MAIL_USER'],
        gmailUserMissing: true,
        secure: false
      }
    }

    const from = resolveFromAddress(input, user)
    return {
      configured: true,
      source: 'gmail',
      missing: [],
      gmailUserMissing: false,
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      authUser: user,
      authPass: normalizeGmailAppPassword(gmailPassRaw),
      from: from ?? `Müvekkil Kasa Defteri <${user}>`
    }
  }

  const missing: string[] = []
  if (!optionalTrim(input.SMTP_HOST)) missing.push('SMTP_HOST')
  if (!optionalTrim(input.SMTP_PORT)) missing.push('SMTP_PORT')
  if (!optionalTrim(input.SMTP_USER)) missing.push('SMTP_USER')
  if (!optionalTrim(input.SMTP_PASS)) missing.push('SMTP_PASS')
  if (!resolveFromAddress(input)) missing.push('SMTP_FROM veya MAIL_FROM')

  return {
    configured: false,
    source: null,
    missing,
    gmailUserMissing: false,
    secure: false
  }
}

export function getResolvedMailTransport(): ResolvedMailTransport {
  return resolveMailTransport(env)
}

/** @deprecated getResolvedMailTransport kullanın */
export function getSmtpConfigStatus(): ResolvedMailTransport {
  return getResolvedMailTransport()
}

const PRODUCTION_MK_FRONTEND_FALLBACK = 'https://app.muvekkilkasasi.com'

function isProductionEnv(): boolean {
  return env.NODE_ENV === 'production'
}

/** Production mail/linklerinde localhost veya özel ağ adresi kullanılmamalı. */
export function frontendUrlLooksLocalOrPrivate(raw: string): boolean {
  const t = raw.trim().toLowerCase()
  if (!t) return true
  return (
    t.includes('localhost') ||
    t.includes('127.0.0.1') ||
    t.includes('0.0.0.0') ||
    t.includes('[::1]') ||
    /^https?:\/\/192\.168\./.test(t) ||
    /^https?:\/\/10\./.test(t) ||
    /^https?:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\./.test(t)
  )
}

function normalizeFrontendBase(raw: string): string | null {
  // Env değeri virgülle ayrılmış liste veya sonda virgül/boşluk içerebilir ("https://x,");
  // ilk geçerli segmenti al ve baştaki/sondaki noktalama/boşlukları temizle.
  let base = (raw.split(',')[0] ?? '').trim()
  base = base.replace(/[\s,;]+$/, '')
  base = base.replace(/\/$/, '')
  base = base.replace(/\/reset-password\/?$/, '')
  base = base.replace(/\/login\/?$/, '')
  base = base.replace(/[\s,;]+$/, '')
  if (!base || base === 'undefined' || base.includes('null')) return null
  if (isProductionEnv() && frontendUrlLooksLocalOrPrivate(base)) return null
  return base
}

function pickFrontendBase(candidates: Array<string | undefined>): string | null {
  for (const raw of candidates) {
    const trimmed = optionalTrim(raw)
    if (!trimmed) continue
    const base = normalizeFrontendBase(trimmed)
    if (base) return base
  }
  return null
}

/** Şifre sıfırlama linki kökü (frontend). */
export function getFrontendBaseUrl(): string {
  const base = pickFrontendBase([
    optionalTrim(env.RESET_PASSWORD_URL),
    optionalTrim(env.FRONTEND_URL),
    optionalTrim(env.PUBLIC_APP_URL),
    optionalTrim(env.APP_URL),
    ...(isProductionEnv() ? [] : [optionalTrim(env.CORS_ORIGIN)]),
  ])
  if (base) return base

  if (isProductionEnv()) {
    console.error(
      '[mail] Production FRONTEND_URL (veya eşdeğeri) eksik veya localhost; güvenli fallback kullanılıyor:',
      PRODUCTION_MK_FRONTEND_FALLBACK,
    )
    return PRODUCTION_MK_FRONTEND_FALLBACK
  }

  return optionalTrim(env.CORS_ORIGIN) ?? 'http://localhost:5173'
}

/** Müvekkil Kasa giriş ekranı URL’si; öncelik FRONTEND_URL. */
export function getMkLoginUrl(): string {
  const base =
    pickFrontendBase([
      optionalTrim(env.FRONTEND_URL),
      optionalTrim(env.PUBLIC_APP_URL),
      optionalTrim(env.APP_URL),
      optionalTrim(env.RESET_PASSWORD_URL),
      ...(isProductionEnv() ? [] : [optionalTrim(env.CORS_ORIGIN)]),
    ]) ?? (isProductionEnv() ? PRODUCTION_MK_FRONTEND_FALLBACK : optionalTrim(env.CORS_ORIGIN) ?? 'http://localhost:5173')

  const clean = base.replace(/\/$/, '')
  return clean.endsWith('/login') ? clean : `${clean}/login`
}

export function buildPasswordResetUrl(plainToken: string): string {
  const base = getFrontendBaseUrl()
  return `${base}/reset-password?token=${encodeURIComponent(plainToken)}`
}

export function getMailFromAddress(): string | undefined {
  const cfg = getResolvedMailTransport()
  if (cfg.from) return cfg.from
  return optionalTrim(env.MAIL_FROM) ?? optionalTrim(env.SMTP_FROM)
}

export function logMailConfigOnStartup(): void {
  const cfg = getResolvedMailTransport()
  const frontend = getFrontendBaseUrl()
  console.info('[mail] Şifre sıfırlama link kökü:', frontend)

  if (cfg.gmailUserMissing) {
    console.error('[mail] GMAIL_APP_PASSWORD var ama GMAIL_USER/SMTP_USER/MAIL_USER tanımlı değil.')
  }

  if (!cfg.configured) {
    const gmailUser = optionalTrim(env.GMAIL_USER)
    const gmailPass = optionalTrim(env.GMAIL_APP_PASSWORD)
    if (!gmailUser) console.error('[mail] GMAIL_USER eksik')
    if (!gmailPass) console.error('[mail] GMAIL_APP_PASSWORD eksik')
    console.warn('[mail] SMTP yapılandırması eksik:', cfg.missing.join(', ') || '(bilinmeyen)')
    if (env.NODE_ENV === 'development') {
      console.warn('[mail] Geliştirme modunda sıfırlama bağlantıları konsola yazdırılacak.')
    } else {
      console.warn('[mail] Üretimde aktivasyon ve şifre sıfırlama e-postası SMTP olmadan gönderilemez.')
    }
    return
  }

  const label = cfg.source === 'gmail' ? 'Gmail SMTP' : 'SMTP'
  console.info(`[mail] ${label} yapılandırıldı: ${cfg.host}:${cfg.port} (secure=${cfg.secure})`)
  console.info('[mail] Gönderen adres:', cfg.from)
}
