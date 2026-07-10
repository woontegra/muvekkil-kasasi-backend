/**
 * Şifre sıfırlama akışı doğrulaması.
 * Çalıştır: npx tsx scripts/test-password-reset.ts
 */
import { createApp } from '../src/app.js'
import { hashResetToken } from '../src/auth/passwordReset.service.js'
import { prisma } from '../src/lib/prisma.js'

async function post(base: string, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json }
}

async function main(): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { aktifMi: true, eposta: { not: null } },
    select: { id: true, eposta: true, kullaniciAdi: true, tenantId: true, sifreHash: true }
  })
  if (!user?.eposta) {
    console.error('Test için e-postalı aktif kullanıcı bulunamadı.')
    process.exit(1)
  }

  const app = createApp()
  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`

  const publicMsg = 'Bilgiler sistemde kayıtlıysa şifre sıfırlama bağlantısı gönderilecektir.'
  let ok = true

  // B) Unknown email
  const unknown = await post(base, '/api/v1/auth/forgot-password', { identifier: 'nobody-test@example.invalid' })
  if (unknown.status !== 200 || unknown.json.message !== publicMsg) {
    console.error('FAIL B: unknown email', unknown)
    ok = false
  } else {
    console.log('PASS B: unknown email returns same success message')
  }

  // A) Registered user by email
  const forgot = await post(base, '/api/v1/auth/forgot-password', { identifier: user.eposta })
  if (forgot.status !== 200 || forgot.json.message !== publicMsg) {
    console.error('FAIL A: forgot by email', forgot)
    ok = false
  } else {
    console.log('PASS A: forgot by email returns success')
  }

  const tokenRow = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, usedAt: null },
    orderBy: { createdAt: 'desc' }
  })
  if (!tokenRow) {
    console.error('FAIL A: no reset token in DB')
    ok = false
  } else {
    console.log('PASS A: reset token saved in DB, expiresAt:', tokenRow.expiresAt.toISOString())
  }

  // We need plain token for reset — only available from dev console in real flow.
  // For test, create a known token directly.
  const plainToken = 'test-reset-token-' + Date.now()
  const tokenHash = hashResetToken(plainToken)
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    }
  })

  const newPassword = 'TestSifre123!'
  const reset = await post(base, '/api/v1/auth/reset-password', {
    token: plainToken,
    yeniSifre: newPassword,
    yeniSifreTekrar: newPassword
  })
  if (reset.status !== 200) {
    console.error('FAIL A: reset password', reset)
    ok = false
  } else {
    console.log('PASS A: reset password succeeded')
  }

  const login = await post(base, '/api/v1/auth/login', {
    identifier: user.kullaniciAdi,
    sifre: newPassword
  })
  if (login.status !== 200) {
    console.error('FAIL A: login with new password', login)
    ok = false
  } else {
    console.log('PASS A: login with new password succeeded')
  }

  // D) Used token
  const reuse = await post(base, '/api/v1/auth/reset-password', {
    token: plainToken,
    yeniSifre: 'AnotherPass123!',
    yeniSifreTekrar: 'AnotherPass123!'
  })
  if (reuse.status !== 400) {
    console.error('FAIL D: reused token should fail', reuse)
    ok = false
  } else {
    console.log('PASS D: used token rejected')
  }

  // C) Expired token
  const expiredPlain = 'expired-token-' + Date.now()
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashResetToken(expiredPlain),
      expiresAt: new Date(Date.now() - 60_000)
    }
  })
  const expired = await post(base, '/api/v1/auth/reset-password', {
    token: expiredPlain,
    yeniSifre: 'ExpiredTest123!',
    yeniSifreTekrar: 'ExpiredTest123!'
  })
  if (expired.status !== 400) {
    console.error('FAIL C: expired token should fail', expired)
    ok = false
  } else {
    console.log('PASS C: expired token rejected')
  }

  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))

  await prisma.user.update({
    where: { id: user.id },
    data: { sifreHash: user.sifreHash }
  })
  console.log('(Test şifresi orijinal değere geri alındı.)')

  await prisma.$disconnect()
  console.log(ok ? '\nTÜM TESTLER GEÇTİ' : '\nBAZI TESTLER BAŞARISIZ')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
