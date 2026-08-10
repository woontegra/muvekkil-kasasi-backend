/**
 * Lisans bitiş hatırlatma planlayıcı — günde bir kez çalıştırılır.
 * Çalıştır: npm run license:reminder
 *
 * Gerçek gönderim için LICENSE_REMINDER_SEND_ENABLED=true gerekir.
 * Varsayılan: dry-run (mail gönderilmez).
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { processLicenseExpiryReminders } from '../src/license/licenseExpiryReminder.service.js'

async function main(): Promise<void> {
  await prisma.$connect()
  const sendEnabled = process.env.LICENSE_REMINDER_SEND_ENABLED === 'true'
  const result = await processLicenseExpiryReminders({ sendEnabled })
  // eslint-disable-next-line no-console
  console.info(
    `[license:reminder] sendEnabled=${sendEnabled} scanned=${result.scanned} due=${result.due} sent=${result.sent} skipped=${result.skipped} failed=${result.failed} dryRun=${result.dryRun}`
  )
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[license:reminder]', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
