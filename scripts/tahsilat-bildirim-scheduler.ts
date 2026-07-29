/**
 * Tahsilat bildirim planlayıcı — bir kez çalışır ve çıkar.
 * Çalıştır: npm run bildirim:scheduler
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { planJobsForAllTenants } from '../src/tahsilatBildirim/planner.service.js'

async function main(): Promise<void> {
  await prisma.$connect()
  const result = await planJobsForAllTenants()
  // eslint-disable-next-line no-console
  console.info(
    `[bildirim:scheduler] tenants=${result.tenants} created=${result.created} cancelled=${result.cancelled}`
  )
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[bildirim:scheduler]', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
