export type BackupFailureNotice = {
  tenantId: string
  stage: string
  code: string
}

export function buildBackupFailureMail(failures: BackupFailureNotice[]): { subject: string; text: string } {
  const lines = failures.map((f) => `tenant=${f.tenantId} stage=${f.stage} code=${f.code}`)
  return {
    subject: `Müvekkil Kasa backup hatası (${failures.length})`,
    text: ['Müvekkil Kasa tenant backup hataları', `adet: ${failures.length}`, '', ...lines].join('\n')
  }
}

export async function notifyBackupFailures(
  failures: BackupFailureNotice[],
  send?: (mail: { to: string; subject: string; text: string }) => Promise<void>
): Promise<{ sent: boolean; code?: string }> {
  if (failures.length === 0) return { sent: false, code: 'NO_FAILURES' }
  const mail = buildBackupFailureMail(failures)
  try {
    if (send) {
      await send({ to: '', subject: mail.subject, text: mail.text })
      return { sent: true }
    }
    return await sendWithExistingMail(mail)
  } catch {
    return { sent: false, code: 'MAIL_FAILED' }
  }
}

async function sendWithExistingMail(mail: { subject: string; text: string }): Promise<{ sent: boolean; code?: string }> {
  const { getAdminNotificationEmail, getMailFromAddress, getResolvedMailTransport } = await import(
    '../mail/mail.config.js'
  )
  const to = getAdminNotificationEmail()
  if (!to) return { sent: false, code: 'admin_notification_email_missing' }
  const cfg = getResolvedMailTransport()
  const from = getMailFromAddress()
  if (!cfg.configured || !cfg.host || !cfg.port || !cfg.authUser || !cfg.authPass || !from) {
    return { sent: false, code: 'smtp_not_configured' }
  }
  const nodemailer = await import('nodemailer')
  const tx = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.authUser, pass: cfg.authPass }
  })
  await tx.sendMail({ from, to, subject: mail.subject, text: mail.text })
  return { sent: true }
}
