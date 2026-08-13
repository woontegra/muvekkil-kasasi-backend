/**
 * Tahsilat bildirim worker — vadesi gelen işleri bir kez işler ve çıkar.
 * Çalıştır: npm run bildirim:worker
 * Gerçek WhatsApp Cloud API çağrısı yapılmaz (Faz 1).
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { processDueJobs } from '../src/tahsilatBildirim/worker.service.js'
import { processDueRandevuJobs } from '../src/randevu/randevuBildirim.worker.js'

async function main(): Promise<void> {
  await prisma.$connect()
  const tahsilat = await processDueJobs({
    limit: 100,
    workerId: `cli-${process.pid}`
  })
  const randevu = await processDueRandevuJobs({
    limit: 100,
    workerId: `cli-randevu-${process.pid}`
  })
  // eslint-disable-next-line no-console
  console.info(
    `[bildirim:worker] tahsilat processed=${tahsilat.processed} simulasyon=${tahsilat.simulasyon} basarisiz=${tahsilat.basarisiz} | randevu processed=${randevu.processed} simulasyon=${randevu.simulasyon} basarisiz=${randevu.basarisiz}`
  )
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[bildirim:worker]', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
