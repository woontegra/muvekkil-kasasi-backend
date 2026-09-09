/**
 * Yıllık dahil WhatsApp 500 kredi — gerçek lisans akışları kalite testi.
 *
 *   npm run test:whatsapp-annual-grant
 *
 * extendTenantLicense / tryGrant / Website-sim / Admin-sim senaryoları.
 * Production tenantlara toplu 500 dağıtmaz; yalnız test tenant bakiyesini geçici oynar.
 */
import 'dotenv/config'
import { WhatsAppMesajKrediHareketTipi } from '@prisma/client'
import { prisma } from '../src/lib/prisma.js'
import { extendTenantLicense } from '../src/tenant/extendTenantLicense.js'
import {
  adjustManuelCredit,
  ensureWhatsAppMesajKredisi,
  getBalance,
  getTransactions,
  isEligibleForAnnualWhatsAppCredits,
  tryGrantAnnualIncludedCreditsAfterLicensePeriod,
  WHATSAPP_YILLIK_DAHIL_KREDI
} from '../src/tahsilatBildirim/whatsappMesajKredi.service.js'

const TAG = `annual-grant-${Date.now()}`

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`FAIL: ${m}`)
}

let n = 0
function ok(name: string): void {
  n += 1
  // eslint-disable-next-line no-console
  console.log(`OK  ${name}`)
}

async function main(): Promise<void> {
  assert(WHATSAPP_YILLIK_DAHIL_KREDI === 500, 'constant 500')

  const tenant = await prisma.tenant.findFirst({
    where: { aktifMi: true },
    select: { id: true, buroAdi: true, demoMu: true, lisansDurumu: true, lisansBitisTarihi: true }
  })
  assert(Boolean(tenant), 'aktif tenant yok')
  const tenantId = tenant!.id
  // eslint-disable-next-line no-console
  console.log(`tenant=${tenant!.buroAdi} (${tenantId})`)

  await ensureWhatsAppMesajKredisi(tenantId)
  const snapshot = await getBalance(tenantId)
  const snapTenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: {
      demoMu: true,
      lisansDurumu: true,
      lisansBitisTarihi: true,
      lisansBaslangicTarihi: true,
      lisansNotlari: true
    }
  })

  const createdRenewalIds: string[] = []

  try {
    // İzole başlangıç: bakiye 0
    const cur0 = await getBalance(tenantId)
    if (cur0 > 0) {
      await adjustManuelCredit({
        tenantId,
        amount: cur0,
        yon: 'DUS',
        aciklama: `${TAG} drain`
      })
    }
    assert((await getBalance(tenantId)) === 0, 'start 0')

    // --- Eligibility unit ---
    assert(!isEligibleForAnnualWhatsAppCredits({ demoMu: true, renewalDays: 365 }), 'demo')
    assert(!isEligibleForAnnualWhatsAppCredits({ lisansPaketi: 'AYLIK', renewalDays: 30 }), 'aylik')
    assert(!isEligibleForAnnualWhatsAppCredits({ lisansPaketi: 'UC_AY', renewalDays: 90 }), '3ay')
    assert(!isEligibleForAnnualWhatsAppCredits({ lisansPaketi: 'ALTI_AY', renewalDays: 180 }), '6ay')
    assert(isEligibleForAnnualWhatsAppCredits({ lisansPaketi: 'YILLIK', demoMu: false }), 'yillik paket')
    assert(isEligibleForAnnualWhatsAppCredits({ renewalDays: 365, demoMu: false }), '365 gün')
    ok('eligibility kuralları')

    // --- Demo grant → +0 ---
    const demoPeriod = `demo-${TAG}`
    const demoG = await tryGrantAnnualIncludedCreditsAfterLicensePeriod({
      tenantId,
      licensePeriodId: demoPeriod,
      renewalDays: 365,
      demoMu: true,
      lisansDurumu: 'DEMO'
    })
    assert('skipped' in demoG && demoG.reason === 'NOT_ELIGIBLE', 'demo skip')
    assert((await getBalance(tenantId)) === 0, 'demo bakiye 0')
    ok('Demo tenant → bakiye 0')

    // --- Demo → yıllık (Website fulfill / admin extend simülasyonu) ---
    const rDemoToAnnual = await extendTenantLicense({
      tenantId,
      source: 'WOONTEGRA_WEBSITE',
      renewalDays: 365,
      demoMu: false,
      note: `${TAG} demo→yıllık`,
      externalOrderId: `ext-demo-annual-${TAG}`
    })
    createdRenewalIds.push(rDemoToAnnual.renewal.id)
    assert((await getBalance(tenantId)) === 500, 'demo→yıllık +500')
    const h1 = await prisma.whatsAppMesajKrediHareketi.findFirst({
      where: {
        tenantId,
        tip: WhatsAppMesajKrediHareketTipi.YILLIK_DAHIL,
        licensePeriodId: rDemoToAnnual.renewal.id
      }
    })
    assert(Boolean(h1) && h1!.miktar === 500, 'YILLIK_DAHIL hareket')
    ok('Demo’dan yıllık lisansa geç → +500')

    // --- Aynı fulfill/aktivasyon ikinci kez → +0 ---
    const again = await tryGrantAnnualIncludedCreditsAfterLicensePeriod({
      tenantId,
      licensePeriodId: rDemoToAnnual.renewal.id,
      renewalDays: 365,
      demoMu: false
    })
    assert(!('skipped' in again) && again.alreadyGranted === true && again.granted === 0, 'idempotent')
    assert((await getBalance(tenantId)) === 500, 'hâlâ 500')
    const cnt = await prisma.whatsAppMesajKrediHareketi.count({
      where: {
        tenantId,
        tip: WhatsAppMesajKrediHareketTipi.YILLIK_DAHIL,
        licensePeriodId: rDemoToAnnual.renewal.id
      }
    })
    assert(cnt === 1, 'tek hareket')
    ok('Aynı dönem ikinci kez → +0')

    // --- Sıfırdan ilk yıllık (Website provision sim) ---
    // Bakiye sıfırla, yeni period id ile grant (provision externalOrderId modeli)
    await adjustManuelCredit({
      tenantId,
      amount: 500,
      yon: 'DUS',
      aciklama: `${TAG} reset-for-first`
    })
    assert((await getBalance(tenantId)) === 0, 'reset 0')
    const firstOrder = `website-provision-${TAG}`
    const first = await tryGrantAnnualIncludedCreditsAfterLicensePeriod({
      tenantId,
      licensePeriodId: firstOrder,
      renewalDays: 365,
      demoMu: false,
      lisansDurumu: 'AKTIF'
    })
    assert(!('skipped' in first) && first.granted === 500, 'first grant')
    assert((await getBalance(tenantId)) === 500, 'ilk yıllık 500')
    ok('Sıfırdan ilk yıllık (Website provision sim) → +500')

    // --- Admin yıllık lisans verme sim ---
    await adjustManuelCredit({
      tenantId,
      amount: 500,
      yon: 'DUS',
      aciklama: `${TAG} reset-admin`
    })
    const adminPeriod = `admin-provision:${tenantId}:YILLIK:${TAG.slice(-8)}`
    const adminG = await tryGrantAnnualIncludedCreditsAfterLicensePeriod({
      tenantId,
      licensePeriodId: adminPeriod,
      renewalDays: 365,
      demoMu: false,
      lisansDurumu: 'AKTIF',
      lisansPaketi: 'YILLIK'
    })
    assert(!('skipped' in adminG) && adminG.granted === 500, 'admin yıllık')
    assert((await getBalance(tenantId)) === 500, 'admin 500')
    ok('Admin yıllık lisans verme → +500')

    // --- Yıllık yenileme → +500 (stack) ---
    const rRenew = await extendTenantLicense({
      tenantId,
      source: 'WOONTEGRA_WEBSITE',
      renewalDays: 365,
      demoMu: false,
      note: `${TAG} yenileme`,
      externalOrderId: `ext-renew-${TAG}`
    })
    createdRenewalIds.push(rRenew.renewal.id)
    assert((await getBalance(tenantId)) === 1000, 'yenileme 500+500=1000')
    ok('Yıllık yenileme → +500')

    // --- Aylık / 3 / 6 → +0 ---
    const beforeShort = await getBalance(tenantId)
    for (const [label, days, paket] of [
      ['aylık', 30, 'AYLIK'],
      ['3 aylık', 90, 'UC_AY'],
      ['6 aylık', 180, 'ALTI_AY']
    ] as const) {
      const g = await tryGrantAnnualIncludedCreditsAfterLicensePeriod({
        tenantId,
        licensePeriodId: `${label}-${TAG}`,
        renewalDays: days,
        demoMu: false,
        lisansPaketi: paket
      })
      assert('skipped' in g && g.reason === 'NOT_ELIGIBLE', `${label} skip`)
    }
    assert((await getBalance(tenantId)) === beforeShort, 'kısa paket bakiye aynı')
    ok('Aylık / 3 aylık / 6 aylık → +0')

    // --- Mevcut 120 + yıllık → 620 ---
    const balNow = await getBalance(tenantId)
    if (balNow > 120) {
      await adjustManuelCredit({
        tenantId,
        amount: balNow - 120,
        yon: 'DUS',
        aciklama: `${TAG} set-120`
      })
    } else if (balNow < 120) {
      await adjustManuelCredit({
        tenantId,
        amount: 120 - balNow,
        yon: 'EKLE',
        aciklama: `${TAG} set-120`
      })
    }
    assert((await getBalance(tenantId)) === 120, '120')
    const rStack = await extendTenantLicense({
      tenantId,
      source: 'SUPER_ADMIN',
      renewalDays: 365,
      demoMu: false,
      note: `${TAG} stack-120`,
      externalOrderId: `ext-stack-${TAG}`
    })
    createdRenewalIds.push(rStack.renewal.id)
    assert((await getBalance(tenantId)) === 620, '120+500=620')
    ok('Mevcut bakiye 120 iken yıllık yenileme → 620')

    // --- MANUEL vs YILLIK_DAHIL ayrımı ---
    await adjustManuelCredit({
      tenantId,
      amount: 10,
      yon: 'EKLE',
      aciklama: `${TAG} manuel-10`
    })
    const txs = await getTransactions(tenantId, { limit: 30 })
    const manuel = txs.items.find(
      (h) => h.tip === WhatsAppMesajKrediHareketTipi.MANUEL_DUZELTME && h.aciklama?.includes(TAG)
    )
    const yillik = txs.items.find(
      (h) =>
        h.tip === WhatsAppMesajKrediHareketTipi.YILLIK_DAHIL &&
        h.licensePeriodId === rStack.renewal.id
    )
    assert(Boolean(manuel) && manuel!.miktar === 10, 'MANUEL_DUZELTME ayrı')
    assert(Boolean(yillik) && yillik!.miktar === 500, 'YILLIK_DAHIL ayrı')
    ok('MANUEL_DUZELTME ≠ YILLIK_DAHIL')

    // eslint-disable-next-line no-console
    console.log(`${n} yıllık grant senaryosu geçti.`)
    // eslint-disable-next-line no-console
    console.log(
      [
        'GRANT_SITES:',
        'extendTenantLicense → tryGrantAnnualIncludedCreditsAfterLicensePeriod(renewal.id)',
        'woontegraWebsiteProvision → tryGrant(... externalOrderId)',
        'licensePurchase.fulfill → extendTenantLicense (veya heal existingRenewal.id)',
        'woontegraWebsiteRenew → extendTenantLicense',
        'adminCreateTenantWithOwner → tryGrant(admin-provision:…)'
      ].join('\n  ')
    )
  } finally {
    await prisma.whatsAppMesajKrediHareketi.deleteMany({
      where: {
        tenantId,
        OR: [
          { aciklama: { contains: TAG } },
          { licensePeriodId: { contains: TAG } },
          ...(createdRenewalIds.length
            ? [{ licensePeriodId: { in: createdRenewalIds } }]
            : [])
        ]
      }
    })
    // Test renewals — sil (external order TAG’li)
    await prisma.tenantLicenseRenewal.deleteMany({
      where: {
        tenantId,
        OR: [
          { id: { in: createdRenewalIds } },
          { note: { contains: TAG } },
          { externalOrderId: { contains: TAG } }
        ]
      }
    })
    await prisma.whatsAppMesajKredisi.update({
      where: { tenantId },
      data: { bakiye: snapshot }
    })
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        demoMu: snapTenant.demoMu,
        lisansDurumu: snapTenant.lisansDurumu,
        lisansBitisTarihi: snapTenant.lisansBitisTarihi,
        lisansBaslangicTarihi: snapTenant.lisansBaslangicTarihi,
        lisansNotlari: snapTenant.lisansNotlari
      }
    })
    // eslint-disable-next-line no-console
    console.log(`cleanup bakiye=${await getBalance(tenantId)} (hedef ${snapshot})`)
    await prisma.$disconnect()
  }
}

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
