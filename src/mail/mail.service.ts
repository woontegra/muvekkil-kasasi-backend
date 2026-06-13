import { env } from '../config/env.js'

export type SendPasswordResetEmailParams = {
  to: string
  plainToken: string
}

/**
 * Şifre sıfırlama bildirimi. SMTP entegrasyonu öncesi: geliştirmede bağlantı loglanır.
 * Üretimde gerçek sağlayıcı (Resend, SendGrid, …) burada çağrılmalıdır.
 */
export async function sendPasswordResetEmail(params: SendPasswordResetEmailParams): Promise<void> {
  const base = (env.PUBLIC_APP_URL ?? env.CORS_ORIGIN).replace(/\/$/, '')
  const url = `${base}/reset-password?token=${encodeURIComponent(params.plainToken)}`

  if (env.NODE_ENV === 'development') {
    console.info('[mail:dev] Password reset — alıcı:', params.to)
    console.info('[mail:dev] Reset linki (SMTP gönderilmedi):', url)
    return
  }

  console.info('[mail] Password reset e-postası kuyruğa alınmadı (placeholder). Alıcı:', params.to)
}
