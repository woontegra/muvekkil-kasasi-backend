import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { env } from '../config/env.js'
import {
  buildPasswordResetUrl,
  getFrontendBaseUrl,
  getMailFromAddress,
  getResolvedMailTransport
} from './mail.config.js'

export type SendPasswordResetEmailParams = {
  to: string
  plainToken: string
}

const RESET_SUBJECT = 'Müvekkil Kasa Defteri Şifre Sıfırlama'
const TOKEN_EXPIRES_MINUTES = 30

let transporter: Transporter | null = null

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain || !local) return '***'
  const visible = local.length <= 2 ? local[0] ?? '*' : `${local.slice(0, 2)}***`
  return `${visible}@${domain}`
}

function getTransporter(): Transporter | null {
  const cfg = getResolvedMailTransport()
  if (!cfg.configured || !cfg.host || !cfg.port || !cfg.authUser || !cfg.authPass) return null

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: {
        user: cfg.authUser,
        pass: cfg.authPass
      }
    })
  }
  return transporter
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildResetEmailHtml(resetUrl: string): string {
  const safeUrl = escapeHtml(resetUrl)
  const year = new Date().getFullYear()

  return `<!DOCTYPE html>
<html lang="tr" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${RESET_SUBJECT}</title>
</head>
<body style="margin:0;padding:0;width:100% !important;background-color:#f3f6fb;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f6fb;margin:0;padding:0;width:100%;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 4px 24px rgba(15,23,42,0.08);overflow:hidden;">
          <!-- Marka -->
          <tr>
            <td style="padding:32px 40px 24px 40px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.14em;color:#64748b;text-transform:uppercase;">WOONTEGRA</p>
              <p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;line-height:1.3;">Müvekkil Kasa Defteri</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr><td style="border-top:1px solid #e2e8f0;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <!-- İçerik -->
          <tr>
            <td style="padding:28px 40px 8px 40px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#0f172a;line-height:1.35;">Şifre Sıfırlama Talebi</h1>
              <p style="margin:0;font-size:15px;line-height:1.65;color:#334155;">Müvekkil Kasa Defteri hesabınız için şifre sıfırlama talebi aldık.</p>
            </td>
          </tr>
          <!-- Bilgi kutusu -->
          <tr>
            <td style="padding:20px 40px 8px 40px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                <tr>
                  <td style="padding:14px 16px;font-size:14px;line-height:1.6;color:#475569;">
                    Bu bağlantı <strong style="color:#0f172a;">${TOKEN_EXPIRES_MINUTES} dakika</strong> boyunca geçerlidir. Süre dolduysa yeniden şifre sıfırlama talebi oluşturabilirsiniz.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Buton -->
          <tr>
            <td align="center" style="padding:28px 40px 8px 40px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                <tr>
                  <td align="center" bgcolor="#2563eb" style="background-color:#2563eb;border-radius:8px;">
                    <a href="${resetUrl}" target="_blank" style="display:inline-block;padding:14px 36px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;line-height:1.2;mso-padding-alt:0;">Şifremi Sıfırla</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Yedek bağlantı -->
          <tr>
            <td style="padding:20px 40px 8px 40px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 10px;font-size:13px;line-height:1.55;color:#64748b;">Buton çalışmazsa aşağıdaki bağlantıyı tarayıcınıza kopyalayabilirsiniz.</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;">
                <tr>
                  <td style="padding:12px 14px;font-size:12px;line-height:1.55;color:#2563eb;word-break:break-all;">
                    <a href="${resetUrl}" style="color:#2563eb;text-decoration:underline;word-break:break-all;">${safeUrl}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Güvenlik -->
          <tr>
            <td style="padding:20px 40px 32px 40px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">Bu talebi siz oluşturmadıysanız bu e-postayı dikkate almayın. Şifreniz değiştirilmeyecektir.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px 40px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 8px;font-size:12px;line-height:1.55;color:#94a3b8;text-align:center;">Bu e-posta Woontegra Teknoloji Yazılım ve Dijital Hizmetler Ltd. Şti. tarafından gönderilmiştir.</p>
              <p style="margin:0;font-size:11px;line-height:1.4;color:#cbd5e1;text-align:center;">© ${year} Woontegra</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function buildResetEmailText(resetUrl: string): string {
  return [
    'WOONTEGRA — Müvekkil Kasa Defteri',
    '',
    'Şifre Sıfırlama Talebi',
    '',
    'Müvekkil Kasa Defteri hesabınız için şifre sıfırlama talebi aldık.',
    '',
    `Bu bağlantı ${TOKEN_EXPIRES_MINUTES} dakika boyunca geçerlidir. Süre dolduysa yeniden şifre sıfırlama talebi oluşturabilirsiniz.`,
    '',
    'Şifrenizi sıfırlamak için bağlantı:',
    resetUrl,
    '',
    'Bu talebi siz oluşturmadıysanız bu e-postayı dikkate almayın. Şifreniz değiştirilmeyecektir.',
    '',
    '—',
    'Bu e-posta Woontegra Teknoloji Yazılım ve Dijital Hizmetler Ltd. Şti. tarafından gönderilmiştir.',
    `© ${new Date().getFullYear()} Woontegra`
  ].join('\n')
}

/**
 * Şifre sıfırlama e-postası gönderir.
 * SMTP yoksa development modunda bağlantıyı konsola yazar; hata fırlatmaz.
 */
export async function sendPasswordResetEmail(params: SendPasswordResetEmailParams): Promise<void> {
  const resetUrl = buildPasswordResetUrl(params.plainToken)
  const toMasked = maskEmail(params.to)

  console.info('[mail] Password reset mail attempt — recipient:', toMasked)

  const cfg = getResolvedMailTransport()
  const tx = getTransporter()
  const from = cfg.from ?? getMailFromAddress()

  if (!tx || !from) {
    if (env.NODE_ENV === 'development') {
      console.info('[DEV ONLY] Password reset link:', resetUrl)
      console.info('[mail] Password reset mail skipped (SMTP not configured, development mode)')
      return
    }
    console.error('[mail] Password reset mail FAILED — SMTP not configured')
    return
  }

  try {
    await tx.sendMail({
      from,
      to: params.to,
      subject: RESET_SUBJECT,
      text: buildResetEmailText(resetUrl),
      html: buildResetEmailHtml(resetUrl)
    })
    console.info('[mail] Password reset mail sent successfully — recipient:', toMasked)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[mail] Password reset mail FAILED — recipient:', toMasked, '— error:', msg)
  }
}

const WELCOME_SUBJECT = 'Müvekkil Kasa Defteri — Hesabınız Hazır'

export type SendWelcomeActivationEmailParams = {
  to: string
  plainToken: string
  buroAdi: string
  kullaniciAdi: string
  lisansBaslangic: string
  lisansBitis: string
  lisansAnahtari?: string | null
  activationExpiresHours: number
}

function formatDateTr(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return iso
  }
}

function buildWelcomeEmailHtml(params: SendWelcomeActivationEmailParams): string {
  const activationUrl = buildPasswordResetUrl(params.plainToken)
  const loginUrl = `${getFrontendBaseUrl()}/login`
  const safeActivationUrl = escapeHtml(activationUrl)
  const safeLoginUrl = escapeHtml(loginUrl)
  const year = new Date().getFullYear()
  const baslangic = formatDateTr(params.lisansBaslangic)
  const bitis = formatDateTr(params.lisansBitis)
  const licenseKeyLine = params.lisansAnahtari?.trim()
    ? `<strong style="color:#0f172a;">Lisans anahtarı:</strong> <code style="font-family:Consolas,monospace;font-size:13px;color:#0f172a;">${escapeHtml(params.lisansAnahtari.trim())}</code><br/>`
    : ''

  return `<!DOCTYPE html>
<html lang="tr" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${WELCOME_SUBJECT}</title>
</head>
<body style="margin:0;padding:0;width:100% !important;background-color:#f3f6fb;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f6fb;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="padding:32px 40px 24px;font-family:'Segoe UI',Arial,sans-serif;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.14em;color:#64748b;text-transform:uppercase;">WOONTEGRA</p>
              <p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">Müvekkil Kasa Defteri</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e2e8f0;margin:0;" /></td>
          </tr>
          <tr>
            <td style="padding:28px 40px 8px;font-family:'Segoe UI',Arial,sans-serif;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#0f172a;">Hesabınız Hazır</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#334155;"><strong>${escapeHtml(params.buroAdi)}</strong> için Müvekkil Kasa Defteri web tabanlı hesabınız oluşturuldu.</p>
              <p style="margin:0;font-size:14px;line-height:1.65;color:#475569;">Program indirmeniz veya kurulum yapmanız gerekmez; tarayıcınızdan giriş yaparak kullanmaya başlayabilirsiniz.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 40px;font-family:'Segoe UI',Arial,sans-serif;">
              <table role="presentation" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                <tr>
                  <td style="padding:16px;font-size:14px;line-height:1.7;color:#475569;">
                    <strong style="color:#0f172a;">Giriş adresi:</strong> <a href="${safeLoginUrl}" style="color:#2563eb;">${safeLoginUrl}</a><br/>
                    <strong style="color:#0f172a;">Kullanıcı adı:</strong> ${escapeHtml(params.kullaniciAdi)}<br/>
                    ${licenseKeyLine}
                    <strong style="color:#0f172a;">Lisans:</strong> ${baslangic} — ${bitis}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 40px 8px;font-family:'Segoe UI',Arial,sans-serif;">
              <a href="${safeActivationUrl}" style="display:inline-block;padding:14px 36px;background:#2563eb;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:8px;">Şifrenizi Belirleyin</a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 40px;font-family:'Segoe UI',Arial,sans-serif;">
              <p style="margin:0;font-size:13px;line-height:1.55;color:#64748b;">Bu bağlantı <strong>${params.activationExpiresHours} saat</strong> geçerlidir. Süre dolduysa destek ile iletişime geçin.</p>
              <p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;word-break:break-all;">${safeActivationUrl}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 32px;font-family:'Segoe UI',Arial,sans-serif;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">Güvenliğiniz için şifrenizi kimseyle paylaşmayın. Bu hesabı siz oluşturmadıysanız <a href="mailto:destek@woontegra.com" style="color:#2563eb;">destek@woontegra.com</a> adresine yazın.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-family:'Segoe UI',Arial,sans-serif;">
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">Woontegra Teknoloji Yazılım ve Dijital Hizmetler Ltd. Şti.</p>
              <p style="margin:4px 0 0;font-size:11px;color:#cbd5e1;text-align:center;">© ${year} Woontegra</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function buildWelcomeEmailText(params: SendWelcomeActivationEmailParams): string {
  const activationUrl = buildPasswordResetUrl(params.plainToken)
  const loginUrl = `${getFrontendBaseUrl()}/login`
  const baslangic = formatDateTr(params.lisansBaslangic)
  const bitis = formatDateTr(params.lisansBitis)
  const licenseKeyLine = params.lisansAnahtari?.trim()
    ? `Lisans anahtarı: ${params.lisansAnahtari.trim()}`
  : null

  return [
    'WOONTEGRA — Müvekkil Kasa Defteri',
    '',
    'Hesabınız Hazır',
    '',
    `${params.buroAdi} için Müvekkil Kasa Defteri web tabanlı hesabınız oluşturuldu.`,
    'Program indirmeniz veya kurulum yapmanız gerekmez; tarayıcınızdan giriş yaparak kullanmaya başlayabilirsiniz.',
    '',
    `Giriş adresi: ${loginUrl}`,
    `Kullanıcı adı: ${params.kullaniciAdi}`,
    ...(licenseKeyLine ? [licenseKeyLine] : []),
    `Lisans: ${baslangic} — ${bitis}`,
    '',
    `Şifrenizi belirlemek için bağlantı (${params.activationExpiresHours} saat geçerli):`,
    activationUrl,
    '',
    'Güvenliğiniz için şifrenizi kimseyle paylaşmayın.',
    'Destek: destek@woontegra.com',
    '',
    '—',
    'Woontegra Teknoloji Yazılım ve Dijital Hizmetler Ltd. Şti.',
    `© ${new Date().getFullYear()} Woontegra`
  ].join('\n')
}

export type WelcomeActivationEmailResult = {
  sent: boolean
  error?: string
}

function describeWelcomeMailConfigError(cfg: ReturnType<typeof getResolvedMailTransport>): string {
  if (cfg.gmailUserMissing) {
    return 'GMAIL_APP_PASSWORD var ama GMAIL_USER/SMTP_USER/MAIL_USER eksik'
  }
  const hasGmailUser = !!(env.GMAIL_USER?.trim() || env.MAIL_USER?.trim() || env.SMTP_USER?.trim())
  const hasGmailPass = !!env.GMAIL_APP_PASSWORD?.trim()
  if (!hasGmailUser && !hasGmailPass) {
    return 'GMAIL_USER ve GMAIL_APP_PASSWORD (veya SMTP_HOST/SMTP_USER/SMTP_PASS) tanımlı değil'
  }
  if (!hasGmailUser) return 'GMAIL_USER eksik'
  if (!hasGmailPass) return 'GMAIL_APP_PASSWORD eksik'
  return cfg.missing.length ? `Mail taşıyıcı hazır değil: ${cfg.missing.join(', ')}` : 'SMTP not configured'
}

/**
 * Hoş geldiniz / aktivasyon e-postası gönderir.
 */
export async function sendWelcomeActivationEmail(
  params: SendWelcomeActivationEmailParams
): Promise<WelcomeActivationEmailResult> {
  const toMasked = maskEmail(params.to)
  console.info('[mail] Welcome activation mail attempt — recipient:', toMasked)

  const cfg = getResolvedMailTransport()
  const tx = getTransporter()
  const from = cfg.from ?? getMailFromAddress()
  const activationUrl = buildPasswordResetUrl(params.plainToken)

  if (!tx || !from) {
    const reason = describeWelcomeMailConfigError(cfg)
    if (env.NODE_ENV === 'development') {
      console.info('[DEV ONLY] Activation link:', activationUrl)
      console.info('[mail] Welcome activation mail skipped (SMTP not configured, development mode)')
      return { sent: true }
    }
    console.error('[mail] Welcome activation mail FAILED —', reason)
    return { sent: false, error: reason }
  }

  try {
    await tx.sendMail({
      from,
      to: params.to,
      subject: WELCOME_SUBJECT,
      text: buildWelcomeEmailText(params),
      html: buildWelcomeEmailHtml(params)
    })
    console.info('[mail] Welcome activation mail sent successfully — recipient:', toMasked)
    return { sent: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[mail] Welcome activation mail FAILED — recipient:', toMasked, '— error:', msg)
    return { sent: false, error: msg }
  }
}

export { logMailConfigOnStartup } from './mail.config.js'

const RENEWAL_SUBJECT = 'Müvekkil Kasa Defteri — Lisansınız Yenilendi'

export type SendLicenseRenewalEmailParams = {
  to: string
  buroAdi: string
  lisansAnahtari: string | null
  previousEndDate: string
  newEndDate: string
  renewalDays: number
}

export type LicenseRenewalEmailResult = { sent: boolean; error?: string }

function buildRenewalEmailHtml(params: SendLicenseRenewalEmailParams): string {
  const prev = formatDateTr(params.previousEndDate)
  const next = formatDateTr(params.newEndDate)
  const keyLine = params.lisansAnahtari?.trim()
    ? `<strong style="color:#0f172a;">Lisans anahtarı:</strong> <code style="font-family:Consolas,monospace;font-size:13px;">${escapeHtml(params.lisansAnahtari.trim())}</code><br/>`
    : ''
  const year = new Date().getFullYear()

  return `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8" /><title>${RENEWAL_SUBJECT}</title></head>
<body style="margin:0;padding:24px;background:#f3f6fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
    <tr><td style="padding:28px 32px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Lisansınız Yenilendi</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;"><strong>${escapeHtml(params.buroAdi)}</strong> bürosu için Müvekkil Kasa Defteri lisans süreniz uzatıldı.</p>
      <p style="margin:0;font-size:14px;line-height:1.7;color:#475569;">
        ${keyLine}
        <strong>Eski bitiş:</strong> ${prev}<br/>
        <strong>Yeni bitiş:</strong> ${next}<br/>
        <strong>Yenilenen süre:</strong> ${params.renewalDays} gün
      </p>
      <p style="margin:20px 0 0;font-size:14px;color:#64748b;">Bizi tercih ettiğiniz için teşekkür ederiz.</p>
    </td></tr>
    <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">© ${year} Woontegra</td></tr>
  </table>
</body>
</html>`
}

function buildRenewalEmailText(params: SendLicenseRenewalEmailParams): string {
  const prev = formatDateTr(params.previousEndDate)
  const next = formatDateTr(params.newEndDate)
  const keyLine = params.lisansAnahtari?.trim() ? `Lisans anahtarı: ${params.lisansAnahtari.trim()}\n` : ''
  return `Lisansınız Yenilendi

${params.buroAdi} bürosu için Müvekkil Kasa Defteri lisans süreniz uzatıldı.

${keyLine}Eski bitiş: ${prev}
Yeni bitiş: ${next}
Yenilenen süre: ${params.renewalDays} gün

Bizi tercih ettiğiniz için teşekkür ederiz.
`
}

export async function sendLicenseRenewalEmail(
  params: SendLicenseRenewalEmailParams
): Promise<LicenseRenewalEmailResult> {
  const toMasked = maskEmail(params.to)
  console.info('[mail] License renewal mail attempt — recipient:', toMasked)

  const cfg = getResolvedMailTransport()
  const tx = getTransporter()
  const from = cfg.from ?? getMailFromAddress()

  if (!tx || !from) {
    const reason = describeWelcomeMailConfigError(cfg)
    if (env.NODE_ENV === 'development') {
      console.info('[DEV ONLY] Renewal mail skipped (SMTP not configured)')
      return { sent: true }
    }
    console.error('[mail] License renewal mail FAILED —', reason)
    return { sent: false, error: reason }
  }

  try {
    await tx.sendMail({
      from,
      to: params.to,
      subject: RENEWAL_SUBJECT,
      text: buildRenewalEmailText(params),
      html: buildRenewalEmailHtml(params)
    })
    console.info('[mail] License renewal mail sent — recipient:', toMasked)
    return { sent: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[mail] License renewal mail FAILED —', msg)
    return { sent: false, error: msg }
  }
}
