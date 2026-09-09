/**
 * WhatsApp mesaj kredi servisi kalite testleri (DB yazar, Meta çağırmaz).
 *
 *   npx tsx scripts/whatsapp-mesaj-kredi-quality.ts
 *
 * Test hareketlerini aciklama öneki ile temizler; bakiyeyi başlangıç değerine döndürür.
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { WhatsAppMesajKrediHareketTipi } from '@prisma/client'
import { prisma } from '../src/lib/prisma.js'
import {
  addCredit,
  consumeForJob,
  getBalance,
  grantAnnualIncludedCredits,
  refundForJob,
  WHATSAPP_KREDI_YETERSIZ
} from '../src/tahsilatBildirim/whatsappMesajKredi.service.js'

const TAG = `quality-wa-credit-${Date.now()}`

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findFirst({
    where: { aktifMi: true },
    select: { id: true, buroAdi: true }
  })
  assert(Boolean(tenant), 'aktif tenant yok')
  const tenantId = tenant!.id
  // eslint-disable-next-line no-console
  console.log(`tenant: ${tenant!.buroAdi} (${tenantId})`)

  const snapshot = await getBalance(tenantId)
  // eslint-disable-next-line no-console
  console.log(`snapshot bakiye: ${snapshot}`)

  const jobSend = `job-send-${TAG}`
  const jobZero = `job-zero-${TAG}`
  const jobDup = `job-dup-${TAG}`
  const jobRefund = `job-refund-${TAG}`
  const jobP1 = `job-par1-${TAG}`
  const jobP2 = `job-par2-${TAG}`
  const period = `license-${TAG}`
  const payment = `pay-${TAG}`

  try {
    // İzole başlangıç: bakiyeyi bilinen değere çek (kalite etiketli manuel düzeltme)
    const need = 1
    const cur = await getBalance(tenantId)
    if (cur !== need) {
      const delta = need - cur
      if (delta > 0) {
        await addCredit({
          tenantId,
          amount: delta,
          tip: WhatsAppMesajKrediHareketTipi.MANUEL_DUZELTME,
          aciklama: `${TAG} set-balance-up`
        })
      } else {
        // Fazlalığı düşürmek için geçici consume+refund değil; doğrudan hareket ile azaltamayız
        // (MANUEL_DUZELTME yalnız +). Bu turda bakiyeyi 0'a çekip 1 ekleyelim.
        // Önce mevcut bakiyeyi tüketmek için sentetik job'lar.
        for (let i = 0; i < cur; i += 1) {
          const jid = `job-drain-${TAG}-${i}`
          const c = await consumeForJob(tenantId, jid)
          assert(c.ok, `drain consume ${i}`)
        }
        await addCredit({
          tenantId,
          amount: need,
          tip: WhatsAppMesajKrediHareketTipi.MANUEL_DUZELTME,
          aciklama: `${TAG} set-balance-1`
        })
      }
    }

    assert((await getBalance(tenantId)) === 1, 'başlangıç bakiye 1')

    // 1) bakiye 1 → consume → 0
    const c1 = await consumeForJob(tenantId, jobSend)
    assert(c1.ok === true, 'consume ok')
    assert((await getBalance(tenantId)) === 0, 'bakiye 0 after send')
    // eslint-disable-next-line no-console
    console.log('OK  bakiye 1 → gönderim → bakiye 0')

    // 2) bakiye 0 → Meta yolu consume reddi (çağrı yapılmaz — servis katmanı)
    const c0 = await consumeForJob(tenantId, jobZero)
    assert(c0.ok === false && c0.code === WHATSAPP_KREDI_YETERSIZ, 'KREDI_YETERSIZ')
    assert((await getBalance(tenantId)) === 0, 'bakiye hâlâ 0')
    // eslint-disable-next-line no-console
    console.log('OK  bakiye 0 → consume KREDI_YETERSIZ (Meta yok)')

    // 3) aynı job iki kez → yalnız -1
    await addCredit({
      tenantId,
      amount: 1,
      tip: WhatsAppMesajKrediHareketTipi.MANUEL_DUZELTME,
      aciklama: `${TAG} topup-dup`
    })
    const d1 = await consumeForJob(tenantId, jobDup)
    const d2 = await consumeForJob(tenantId, jobDup)
    assert(d1.ok && d2.ok, 'dup consume ok')
    assert(d2.ok && d2.alreadyConsumed === true, 'ikinci alreadyConsumed')
    assert((await getBalance(tenantId)) === 0, 'dup sonrası bakiye 0')
    const sendCount = await prisma.whatsAppMesajKrediHareketi.count({
      where: { tenantId, jobId: jobDup, tip: WhatsAppMesajKrediHareketTipi.MESAJ_GONDERIM }
    })
    assert(sendCount === 1, 'tek MESAJ_GONDERIM satırı')
    // eslint-disable-next-line no-console
    console.log('OK  aynı job iki kez → yalnız -1')

    // 4) Meta senkron hata → iade
    await addCredit({
      tenantId,
      amount: 1,
      tip: WhatsAppMesajKrediHareketTipi.MANUEL_DUZELTME,
      aciklama: `${TAG} topup-refund`
    })
    const rConsume = await consumeForJob(tenantId, jobRefund)
    assert(rConsume.ok, 'refund path consume')
    assert((await getBalance(tenantId)) === 0, 'refund öncesi 0')
    const ref = await refundForJob(tenantId, jobRefund, `${TAG} meta-fail`)
    assert(ref.ok && !ref.noop, 'refund ok')
    assert((await getBalance(tenantId)) === 1, 'iade sonrası 1')
    const ref2 = await refundForJob(tenantId, jobRefund, `${TAG} meta-fail-2`)
    assert(ref2.alreadyRefunded === true, 'ikinci iade noop/idempotent')
    assert((await getBalance(tenantId)) === 1, 'çift iade bakiyeyi bozmaz')
    // eslint-disable-next-line no-console
    console.log('OK  Meta senkron hata → kredi iade (idempotent)')

    // 5) iki paralel consume (farklı job, bakiye=1) → negatif yok
    // bakiye şu an 1
    const [p1, p2] = await Promise.all([
      consumeForJob(tenantId, jobP1),
      consumeForJob(tenantId, jobP2)
    ])
    const okCount = [p1, p2].filter((x) => x.ok).length
    const failCount = [p1, p2].filter((x) => !x.ok).length
    assert(okCount === 1 && failCount === 1, `paralel 1 ok / 1 fail (ok=${okCount} fail=${failCount})`)
    const balPar = await getBalance(tenantId)
    assert(balPar === 0, `paralel sonrası bakiye 0 (got ${balPar})`)
    assert(balPar >= 0, 'negatif bakiye yok')
    // eslint-disable-next-line no-console
    console.log('OK  iki paralel consume → negatif bakiye oluşmaz')

    // 6) yıllık +500 aynı licensePeriodId yalnız bir kez
    const g1 = await grantAnnualIncludedCredits(tenantId, period, 500)
    assert(g1.ok && g1.granted === 500 && !g1.alreadyGranted, 'ilk yıllık grant')
    const afterGrant = await getBalance(tenantId)
    assert(afterGrant === 500, `grant sonrası 500 (got ${afterGrant})`)
    const g2 = await grantAnnualIncludedCredits(tenantId, period, 500)
    assert(g2.alreadyGranted === true && g2.granted === 0, 'ikinci grant blocked')
    assert((await getBalance(tenantId)) === 500, 'ikinci grant bakiyeyi artırmaz')
    // eslint-disable-next-line no-console
    console.log('OK  +500 yıllık kredi aynı licensePeriodId yalnız bir kez')

    // 7) satın alınan kredi mevcut bakiye üzerine eklenir
    const beforeBuy = await getBalance(tenantId)
    const buy = await addCredit({
      tenantId,
      amount: 100,
      tip: WhatsAppMesajKrediHareketTipi.PAKET_SATIN_ALMA,
      paymentId: payment,
      aciklama: `${TAG} paket`
    })
    assert(buy.ok && !buy.alreadyApplied, 'paket ekleme')
    assert((await getBalance(tenantId)) === beforeBuy + 100, 'paket üzerine ekleme')
    const buy2 = await addCredit({
      tenantId,
      amount: 100,
      tip: WhatsAppMesajKrediHareketTipi.PAKET_SATIN_ALMA,
      paymentId: payment,
      aciklama: `${TAG} paket-dup`
    })
    assert(buy2.alreadyApplied === true, 'aynı paymentId ikinci kez yok')
    assert((await getBalance(tenantId)) === beforeBuy + 100, 'dup payment bakiyeyi bozmaz')
    // eslint-disable-next-line no-console
    console.log('OK  satın alınan kredi mevcut bakiye üzerine eklenir')

    // eslint-disable-next-line no-console
    console.log('\nTüm WhatsApp kredi senaryoları geçti.')
  } finally {
    // Temizlik: kalite hareketlerini sil, bakiyeyi snapshot'a çek
    await prisma.whatsAppMesajKrediHareketi.deleteMany({
      where: {
        tenantId,
        OR: [
          { aciklama: { contains: TAG } },
          { jobId: { startsWith: `job-` } , AND: [{ jobId: { contains: TAG } }] },
          { licensePeriodId: period },
          { paymentId: payment }
        ]
      }
    })
    // job drain satırları da TAG içerir
    await prisma.whatsAppMesajKrediHareketi.deleteMany({
      where: {
        tenantId,
        OR: [
          { jobId: { contains: TAG } },
          { licensePeriodId: { contains: TAG } },
          { paymentId: { contains: TAG } },
          { aciklama: { contains: TAG } }
        ]
      }
    })
    await prisma.whatsAppMesajKredisi.update({
      where: { tenantId },
      data: { bakiye: snapshot }
    })
    // eslint-disable-next-line no-console
    console.log(`cleanup: bakiye restored to ${snapshot}`)
    await prisma.$disconnect()
  }
}

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
