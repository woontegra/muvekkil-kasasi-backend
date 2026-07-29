/**
 * Tahsilat bildirim worker — vadesi gelen işleri bir kez işler ve çıkar.
 * Çalıştır: npm run bildirim:worker
 * Gerçek WhatsApp Cloud API çağrısı yapılmaz (Faz 1).
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { processDueJobs } from '../src/tahsilatBildirim/worker.service.js'

async function main(): Promise<void> {
  await prisma.$connect()
  const result = await processDueJobs({
    limit: 100,
    workerId: `cli-${process.pid}`
  })
  // eslint-disable-next-line no-console
  console.info(
    `[bildirim:worker] processed=${result.processed} simulasyon=${result.simulasyon} basarisiz=${result.basarisiz} atlananTelefon=${result.atlananTelefon} atlananIzin=${result.atlananIzin} atlananDosya=${result.atlananDosya} deferredWindow=${result.deferredWindow}`
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
