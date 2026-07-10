/**
 * Mail config öncelik ve Gmail fallback doğrulaması.
 * Çalıştır: npx tsx scripts/test-mail-config.ts
 */
import { resolveMailTransport } from '../src/mail/mail.config.js'

function assert(name: string, cond: boolean, detail?: string): void {
  if (!cond) {
    console.error('FAIL:', name, detail ?? '')
    process.exitCode = 1
  } else {
    console.log('PASS:', name)
  }
}

// 1) Gmail only
const gmailOnly = resolveMailTransport({
  GMAIL_USER: 'info@woontegra.com',
  GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
  MAIL_FROM: 'Müvekkil Kasa Defteri <info@woontegra.com>'
})
assert('Gmail → smtp.gmail.com:587', gmailOnly.source === 'gmail' && gmailOnly.host === 'smtp.gmail.com' && gmailOnly.port === 587)
assert('Gmail → secure=false', gmailOnly.secure === false)
assert('Gmail → auth pass spaces stripped', gmailOnly.authPass === 'abcdefghijklmnop')
assert('Gmail → configured', gmailOnly.configured === true)

// 2) Explicit SMTP takes priority over Gmail
const smtpPriority = resolveMailTransport({
  SMTP_HOST: 'smtp.custom.com',
  SMTP_PORT: '465',
  SMTP_USER: 'custom@example.com',
  SMTP_PASS: 'secret',
  SMTP_FROM: 'Custom <custom@example.com>',
  GMAIL_USER: 'info@woontegra.com',
  GMAIL_APP_PASSWORD: 'abcd efgh'
})
assert('SMTP priority → source smtp', smtpPriority.source === 'smtp')
assert('SMTP priority → custom host', smtpPriority.host === 'smtp.custom.com')

// 3) GMAIL_APP_PASSWORD without user
const noUser = resolveMailTransport({
  GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop'
})
assert('Gmail no user → not configured', noUser.configured === false)
assert('Gmail no user → flag', noUser.gmailUserMissing === true)

// 4) GMAIL_APP_PASSWORD + SMTP_USER fallback
const smtpUserFallback = resolveMailTransport({
  SMTP_USER: 'fallback@woontegra.com',
  GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop'
})
assert('Gmail uses SMTP_USER fallback', smtpUserFallback.configured && smtpUserFallback.authUser === 'fallback@woontegra.com')

// 5) Nothing configured
const empty = resolveMailTransport({})
assert('Empty → not configured', empty.configured === false)

// 6) Default from for Gmail without MAIL_FROM
const gmailDefaultFrom = resolveMailTransport({
  GMAIL_USER: 'info@woontegra.com',
  GMAIL_APP_PASSWORD: 'abcdefghijklmnop'
})
assert('Gmail default from', gmailDefaultFrom.from === 'Müvekkil Kasa Defteri <info@woontegra.com>')

console.log(process.exitCode === 1 ? '\nBAZI TESTLER BAŞARISIZ' : '\nTÜM TESTLER GEÇTİ')
