/**
 * Sessiz saat kolonu / Prisma client uyumu — DB yazmaz, Meta yok.
 *   npx tsx scripts/sessiz-saat-ayar-quality.ts
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import {
  getSessizSaatleriDikkateAl,
  hasSessizSaatleriDikkateAlColumn,
  resetSessizSaatColumnCache
} from '../src/tahsilatBildirim/sessizSaatColumn.js'
import { ensureTenantBildirimDefaults, ensureWhatsAppBaglantiRow } from '../src/tahsilatBildirim/settings.service.js'

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`FAIL: ${m}`)
}

async function main(): Promise<void> {
  resetSessizSaatColumnCache()
  const hasCol = await hasSessizSaatleriDikkateAlColumn()
  // eslint-disable-next-line no-console
  console.log(`sessiz_saatleri_dikkate_al column exists: ${hasCol}`)

  const tenant = await prisma.tenant.findFirst({ where: { aktifMi: true }, select: { id: true, buroAdi: true } })
  assert(Boolean(tenant), 'aktif tenant yok')
  // eslint-disable-next-line no-console
  console.log(`tenant: ${tenant!.buroAdi}`)

  await ensureWhatsAppBaglantiRow(tenant!.id)
  await ensureTenantBildirimDefaults(tenant!.id)

  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId: tenant!.id } })
  assert(Boolean(baglanti), 'whatsapp_baglanti satırı yok')

  const sessiz = await getSessizSaatleriDikkateAl(tenant!.id)
  assert(sessiz === false || sessiz === true, 'sessiz boolean değil')
  // eslint-disable-next-line no-console
  console.log(`sessizSaatleriDikkateAl read OK: ${sessiz}`)

  // eslint-disable-next-line no-console
  console.log('OK ensure + connection row + sessiz read')
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
