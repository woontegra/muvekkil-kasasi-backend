/**
 * WhatsApp mesaj kredisi Faz 2 — lisans uygunluk + durum eşikleri + grant stack (DB).
 *
 *   npx tsx scripts/whatsapp-mesaj-kredi-faz2-quality.ts
 */

import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import {
  getBalance,
  getWhatsAppMesajKrediOzet,
  isEligibleForAnnualWhatsAppCredits,
  resolveWhatsAppKrediDurum,
  tryGrantAnnualIncludedCreditsAfterLicensePeriod,
  WHATSAPP_KREDI_DUSUK_ESIK,
  WHATSAPP_KREDI_KRITIK_ESIK,
  WHATSAPP_YILLIK_DAHIL_KREDI
} from '../src/tahsilatBildirim/whatsappMesajKredi.service.js'
import { listWhatsAppMesajPaketleri } from '../src/tahsilatBildirim/whatsappMesajPaketleri.js'
import { requireSafeTestDatabaseOrExit } from '../src/lib/assertSafeTestDatabase.js'

requireSafeTestDatabaseOrExit()

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`FAIL: ${m}`)
}

let n = 0
function check(name: string, fn: () => void): void {
  fn()
  n += 1
  // eslint-disable-next-line no-console
  console.log(`OK  ${name}`)
}

async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn()
  n += 1
  // eslint-disable-next-line no-console
  console.log(`OK  ${name}`)
}

check('yıllık 365 gün → eligible', () => {
  assert(isEligibleForAnnualWhatsAppCredits({ renewalDays: 365, demoMu: false }), '365')
  assert(isEligibleForAnnualWhatsAppCredits({ renewalDays: 400, demoMu: false }), '400')
  assert(isEligibleForAnnualWhatsAppCredits({ lisansPaketi: 'YILLIK', demoMu: false }), 'paket')
})

check('aylık / kısa paket → +0', () => {
  assert(!isEligibleForAnnualWhatsAppCredits({ renewalDays: 30, demoMu: false }), '30')
  assert(!isEligibleForAnnualWhatsAppCredits({ renewalDays: 90 }), '90')
  assert(!isEligibleForAnnualWhatsAppCredits({ lisansPaketi: 'AYLIK' }), 'AYLIK')
  assert(!isEligibleForAnnualWhatsAppCredits({ lisansPaketi: 'UC_AY' }), 'UC_AY')
  assert(!isEligibleForAnnualWhatsAppCredits({ lisansPaketi: 'ALTI_AY' }), 'ALTI_AY')
})

check('demo → +0', () => {
  assert(!isEligibleForAnnualWhatsAppCredits({ renewalDays: 365, demoMu: true }), 'demoMu')
  assert(!isEligibleForAnnualWhatsAppCredits({ renewalDays: 365, lisansDurumu: 'DEMO' }), 'DEMO status')
  assert(!isEligibleForAnnualWhatsAppCredits({ lisansPaketi: 'DEMO' }), 'DEMO paket')
})

check('durum eşikleri 100 / 25 / 0', () => {
  assert(resolveWhatsAppKrediDurum(437) === 'NORMAL', '437')
  assert(resolveWhatsAppKrediDurum(WHATSAPP_KREDI_DUSUK_ESIK) === 'DUSUK', '100')
  assert(resolveWhatsAppKrediDurum(50) === 'DUSUK', '50')
  assert(resolveWhatsAppKrediDurum(WHATSAPP_KREDI_KRITIK_ESIK) === 'KRITIK', '25')
  assert(resolveWhatsAppKrediDurum(1) === 'KRITIK', '1')
  assert(resolveWhatsAppKrediDurum(0) === 'TUKENDI', '0')
  assert(resolveWhatsAppKrediDurum(-1) === 'TUKENDI', 'neg')
})

check('paket kataloğu 4 paket + fiyat', () => {
  const p = listWhatsAppMesajPaketleri()
  assert(p.length === 4, '4 paket')
  assert(p.every((x) => x.aktif === true && x.fiyatTL > 0), 'aktif+fiyat')
  assert(p.map((x) => x.mesajAdedi).join(',') === '500,1000,2500,5000', 'adetler')
  assert(WHATSAPP_YILLIK_DAHIL_KREDI === 500, '500 dahil')
})

async function main(): Promise<void> {
  const tag = `faz2-${Date.now()}`
  const tenant = await prisma.tenant.findFirst({
    where: { aktifMi: true },
    select: { id: true, buroAdi: true }
  })
  assert(Boolean(tenant), 'aktif tenant')
  const tenantId = tenant!.id
  const snapshot = await getBalance(tenantId)
  const periodA = `period-a-${tag}`
  const periodB = `period-b-${tag}`
  const periodMonth = `period-m-${tag}`

  try {
    const { ensureWhatsAppMesajKredisi } = await import(
      '../src/tahsilatBildirim/whatsappMesajKredi.service.js'
    )
    await ensureWhatsAppMesajKredisi(tenantId)
    await prisma.whatsAppMesajKredisi.update({
      where: { tenantId },
      data: { bakiye: 120 }
    })
    assert((await getBalance(tenantId)) === 120, 'start 120')

    await checkAsync('mevcut 120 üzerine yıllık +500 → 620', async () => {
      const g = await tryGrantAnnualIncludedCreditsAfterLicensePeriod({
        tenantId,
        licensePeriodId: periodA,
        renewalDays: 365,
        demoMu: false
      })
      assert(!('skipped' in g) && g.ok && g.granted === 500, 'granted 500')
      assert((await getBalance(tenantId)) === 620, '620')
    })

    await checkAsync('aynı dönem tekrar → +0', async () => {
      const g = await tryGrantAnnualIncludedCreditsAfterLicensePeriod({
        tenantId,
        licensePeriodId: periodA,
        renewalDays: 365,
        demoMu: false
      })
      assert(!('skipped' in g) && g.alreadyGranted === true && g.granted === 0, 'already')
      assert((await getBalance(tenantId)) === 620, 'still 620')
    })

    await checkAsync('aylık dönem → +0', async () => {
      const g = await tryGrantAnnualIncludedCreditsAfterLicensePeriod({
        tenantId,
        licensePeriodId: periodMonth,
        renewalDays: 30,
        demoMu: false
      })
      assert('skipped' in g && g.reason === 'NOT_ELIGIBLE', 'skipped monthly')
      assert((await getBalance(tenantId)) === 620, 'monthly no change')
    })

    await checkAsync('demo → +0', async () => {
      const g = await tryGrantAnnualIncludedCreditsAfterLicensePeriod({
        tenantId,
        licensePeriodId: periodB,
        renewalDays: 365,
        demoMu: true
      })
      assert('skipped' in g && g.reason === 'NOT_ELIGIBLE', 'skipped demo')
      assert((await getBalance(tenantId)) === 620, 'demo no change')
    })

    await checkAsync('özet durum alanları', async () => {
      const o = await getWhatsAppMesajKrediOzet(tenantId)
      assert(o.bakiye === 620, 'ozet bakiye')
      assert(o.durum === 'NORMAL', 'NORMAL')
      assert(o.dusukBakiye === false && o.kritikBakiye === false, 'flags')
      assert(o.yillikDahilKredi === 500, 'dahil')
    })

    // eslint-disable-next-line no-console
    console.log(`\n${n} Faz 2 senaryosu geçti.`)
  } finally {
    await prisma.whatsAppMesajKrediHareketi.deleteMany({
      where: {
        tenantId,
        OR: [
          { aciklama: { contains: tag } },
          { jobId: { contains: tag } },
          { licensePeriodId: { contains: tag } }
        ]
      }
    })
    await prisma.whatsAppMesajKredisi.update({
      where: { tenantId },
      data: { bakiye: snapshot }
    })
    // eslint-disable-next-line no-console
    console.log(`cleanup restored bakiye=${snapshot}`)
    await prisma.$disconnect()
  }
}

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
