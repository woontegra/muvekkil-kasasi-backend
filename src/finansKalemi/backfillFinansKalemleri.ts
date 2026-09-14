/**
 * Idempotent backfill: mevcut tenant’lara varsayılan + sistem finans kalemlerini ekler.
 * Production’da yalnız açık onay ile çalıştırın — finansal kayıt oluşturmaz/değiştirmez.
 *
 * Kullanım (onay sonrası):
 *   npx tsx src/finansKalemi/backfillFinansKalemleri.ts
 */
import { prisma } from '../lib/prisma.js'
import { bootstrapTenantFinansKalemleri } from './finansKalemi.service.js'

async function main(): Promise<void> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, buroAdi: true } })
  let totalCreated = 0
  for (const t of tenants) {
    const n = await bootstrapTenantFinansKalemleri(prisma, t.id, null)
    totalCreated += n
    // eslint-disable-next-line no-console
    console.log(`[backfill] ${t.buroAdi} (${t.id}): +${n}`)
  }
  // eslint-disable-next-line no-console
  console.log(`[backfill] done. tenants=${tenants.length} created=${totalCreated}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
