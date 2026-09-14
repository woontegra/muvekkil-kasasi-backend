import { prisma } from '../lib/prisma.js'
import { bootstrapTenantFinansKalemleri } from './finansKalemi.service.js'

async function main(): Promise<void> {
  const t = await prisma.tenant.findFirst({
    where: { buroAdi: { contains: 'Woontegra', mode: 'insensitive' } }
  })
  if (!t) {
    console.log(JSON.stringify({ ok: false, error: 'Woontegra tenant not found' }))
    process.exitCode = 1
    return
  }
  const gelir = await prisma.tenantFinansKalemi.count({
    where: { tenantId: t.id, tur: 'GELIR', sistemMi: false, aktif: true }
  })
  const gider = await prisma.tenantFinansKalemi.count({
    where: { tenantId: t.id, tur: 'GIDER', sistemMi: false, aktif: true }
  })
  const sistem = await prisma.tenantFinansKalemi.count({
    where: { tenantId: t.id, sistemMi: true }
  })
  const total = await prisma.tenantFinansKalemi.count({ where: { tenantId: t.id } })
  const second = await bootstrapTenantFinansKalemleri(prisma, t.id, null)
  const tenants = await prisma.tenant.count()
  const allKalem = await prisma.tenantFinansKalemi.count()
  console.log(
    JSON.stringify(
      {
        ok: true,
        tenant: t.buroAdi,
        tenantId: t.id,
        gelirAktifManuel: gelir,
        giderAktifManuel: gider,
        sistem,
        total,
        secondRunCreated: second,
        tenants,
        allKalemRows: allKalem
      },
      null,
      2
    )
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
