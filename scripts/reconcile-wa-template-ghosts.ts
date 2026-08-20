/**
 * Read-only Graph sync + ghost reconcile for one tenant. No template POST.
 * Usage: npx tsx scripts/reconcile-wa-template-ghosts.ts
 */
import { prisma } from '../src/lib/prisma.js'
import { syncTemplates } from '../src/tahsilatBildirim/connection.service.js'

const TENANT_ID = 'c433539d-fae3-4419-a6d8-9f1b59464d61'

async function main(): Promise<void> {
  const before = await prisma.whatsAppMetaSablon.findMany({
    where: {
      tenantId: TENANT_ID,
      statusNormalized: { in: ['BEKLIYOR', 'GONDERILIYOR'] }
    },
    select: { id: true, metaName: true, libraryKey: true, metaTemplateId: true, statusNormalized: true }
  })
  console.log('before_pending', before.length, before.map((r) => r.metaName))

  const result = await syncTemplates(TENANT_ID)
  console.log({
    synced: result.synced,
    reconciledGhosts: result.reconciledGhosts,
    paginationComplete: result.paginationComplete,
    remoteNames: result.templates.map((t) => t.metaName)
  })

  const after = await prisma.whatsAppMetaSablon.findMany({
    where: {
      tenantId: TENANT_ID,
      OR: [
        { libraryKey: { in: ['TAHSILAT_VADE_ONCESI', 'TAHSILAT_VADE_GUNU', 'RANDEVU_HATIRLATMA'] } },
        { metaName: { in: ['mk_tahsilat_vade_oncesi_v1', 'mk_tahsilat_vade_gunu_v1', 'mk_randevu_hatirlatma_v1'] } }
      ]
    },
    select: { id: true, metaName: true, statusNormalized: true, metaTemplateId: true }
  })
  console.log('after_target_rows', after)
}

main()
  .catch((e) => {
    console.error('reconcile_failed', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
