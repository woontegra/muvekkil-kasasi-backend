/**
 * WhatsApp paket talep → admin e-posta + WhatsApp bildirim kalite testleri.
 *
 *   npm run test:whatsapp-paket-talep-mail
 */
import 'dotenv/config'
import { WhatsAppMesajPaketTalepDurum } from '@prisma/client'
import { prisma } from '../src/lib/prisma.js'
import {
  buildAdminWhatsAppPaketTalepEmailHtml,
  buildAdminWhatsAppPaketTalepEmailText,
  buildAdminWhatsAppPaketTalepSubject
} from '../src/mail/mail.service.js'
import { getAdminWhatsAppPaketTalepleriUrl } from '../src/mail/mail.config.js'
import { getBalance } from '../src/tahsilatBildirim/whatsappMesajKredi.service.js'
import { createWhatsAppMesajPaketTalebi } from '../src/tahsilatBildirim/whatsappMesajPaketTalep.service.js'
import {
  buildAdminPaketTalepWaTemplateComponents,
  ADMIN_PAKET_TALEP_WA_TEMPLATE_DEFAULT
} from '../src/tahsilatBildirim/whatsappMesajPaketTalepAdminWa.js'
import {
  flushAdminWhatsAppPaketTalepNotificationsForTests,
  setAdminWhatsAppPaketTalepMailSenderForTests,
  setAdminWhatsAppPaketTalepWaSenderForTests
} from '../src/tahsilatBildirim/whatsappMesajPaketTalepNotify.js'

const TAG = `quality-wa-paket-mail-${Date.now()}`

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`FAIL: ${m}`)
}

let n = 0
function ok(name: string): void {
  n += 1
  // eslint-disable-next-line no-console
  console.log(`OK  ${name}`)
}

type SentMail = {
  buroAdi: string
  tenantId: string
  packageId: string
  mesajAdedi: number
  fiyatTL: number
  paymentReference: string
}

type SentWa = {
  buroAdi: string
  requestingTenantId: string
  packageId: string
  mesajAdedi: number
  fiyatTL: number
  senderUsed?: string
}

async function main(): Promise<void> {
  const sentMail: SentMail[] = []
  const sentWa: SentWa[] = []
  let failMailNext = false
  let failWaNext = false
  const configuredSender = 'sender-tenant-from-config'
  let lastSenderUsed: string | null = null

  setAdminWhatsAppPaketTalepMailSenderForTests(async (params) => {
    if (failMailNext) {
      failMailNext = false
      return { sent: false, error: 'simulated_smtp_error' }
    }
    sentMail.push(params)
    return { sent: true, subject: buildAdminWhatsAppPaketTalepSubject(params) }
  })

  setAdminWhatsAppPaketTalepWaSenderForTests(async (params) => {
    lastSenderUsed = configuredSender
    if (failWaNext) {
      failWaNext = false
      return {
        sent: false,
        attempted: true,
        error: 'simulated_wa_error',
        code: 'SIMULATED',
        senderTenantId: configuredSender,
        templateName: ADMIN_PAKET_TALEP_WA_TEMPLATE_DEFAULT
      }
    }
    sentWa.push({ ...params, senderUsed: configuredSender })
    return {
      sent: true,
      attempted: true,
      senderTenantId: configuredSender,
      templateName: ADMIN_PAKET_TALEP_WA_TEMPLATE_DEFAULT,
      providerMessageId: `wamid.mock.${Date.now()}`
    }
  })

  const user = await prisma.user.findFirst({
    where: {
      aktifMi: true,
      role: { in: ['BURO_SAHIBI', 'AVUKAT_YONETICI'] },
      tenant: { aktifMi: true }
    },
    include: { tenant: { select: { id: true, buroAdi: true } } }
  })
  assert(Boolean(user?.tenant), 'tenant+yonetici')
  const tenantId = user!.tenantId
  const buroAdi = user!.tenant.buroAdi
  const createdIds: string[] = []
  const balBeforeAll = await getBalance(tenantId)

  // İkinci tenant — “yanlış sender” kontrolü için (varsa)
  const otherTenant = await prisma.tenant.findFirst({
    where: { aktifMi: true, id: { not: tenantId } },
    select: { id: true }
  })

  try {
    const reviewUrl = getAdminWhatsAppPaketTalepleriUrl()
    assert(reviewUrl.endsWith('/admin/whatsapp-paket-talepleri'), 'CTA route')
    const subject = buildAdminWhatsAppPaketTalepSubject({ buroAdi: 'Woontegra', mesajAdedi: 500 })
    assert(
      subject === 'Yeni WhatsApp Mesaj Paketi Talebi – Woontegra – 500 Mesaj',
      `konu: ${subject}`
    )
    const html = buildAdminWhatsAppPaketTalepEmailHtml({
      buroAdi: 'Woontegra',
      tenantId: 'tenant-demo',
      packageId: 'wa_msg_500',
      paketLabel: '500 mesaj',
      mesajAdedi: 500,
      fiyatTL: 250,
      paymentReference: 'WA-20260909-1234',
      talepCreatedAt: new Date().toISOString(),
      reviewUrl
    })
    const text = buildAdminWhatsAppPaketTalepEmailText({
      buroAdi: 'Woontegra',
      tenantId: 'tenant-demo',
      packageId: 'wa_msg_500',
      paketLabel: '500 mesaj',
      mesajAdedi: 500,
      fiyatTL: 250,
      paymentReference: 'WA-20260909-1234',
      talepCreatedAt: new Date().toISOString(),
      reviewUrl
    })
    assert(html.includes('250 TL') && html.includes('Bekliyor'), 'html içerik')
    assert(html.includes('WA-20260909-1234') && html.includes('Ödeme referansı'), 'html payment ref')
    assert(text.includes('Ödeme referansı: WA-20260909-1234'), 'text payment ref')
    assert(text.includes(reviewUrl), 'text CTA')
    const comps = buildAdminPaketTalepWaTemplateComponents({
      buroAdi: 'Woontegra',
      mesajAdedi: 500,
      fiyatTL: 250
    })
    const bodyParams = (comps[0] as { parameters: Array<{ text: string }> }).parameters
    assert(bodyParams[0]!.text === 'Woontegra', 'wa {{1}} büro')
    assert(bodyParams[1]!.text === '500', 'wa {{2}} adet')
    assert(bodyParams[2]!.text === '250 TL', 'wa {{3}} tutar')
    assert(bodyParams[3]!.text === 'Bekliyor', 'wa {{4}} durum')
    assert(bodyParams.length === 4, 'wa param sayısı değişmedi')
    assert(ADMIN_PAKET_TALEP_WA_TEMPLATE_DEFAULT === 'mk_admin_paket_talebi_v1', 'template adı')
    ok('konu + mail/WA içerik + template params')

    await prisma.whatsAppMesajPaketTalebi.updateMany({
      where: {
        tenantId,
        packageId: { in: ['wa_msg_500', 'wa_msg_1000', 'wa_msg_2500'] },
        durum: WhatsAppMesajPaketTalepDurum.BEKLIYOR
      },
      data: { durum: WhatsAppMesajPaketTalepDurum.IPTAL, adminNotu: `${TAG} clean` }
    })

    sentMail.length = 0
    sentWa.length = 0
    const t500 = await createWhatsAppMesajPaketTalebi({
      tenantId,
      userId: user!.id,
      packageId: 'wa_msg_500'
    })
    createdIds.push(t500.talep.id)
    assert(t500.alreadyExists === false, 'yeni 500')
    await flushAdminWhatsAppPaketTalepNotificationsForTests()
    assert(sentMail.length === 1, `500 mail=${sentMail.length}`)
    assert(sentWa.length === 1, `500 wa=${sentWa.length}`)
    assert(sentMail[0]!.mesajAdedi === 500 && sentMail[0]!.fiyatTL === 250, '500 mail fiyat')
    assert(
      sentMail[0]!.paymentReference === t500.talep.paymentReference,
      'mail paymentReference'
    )
    assert(sentWa[0]!.mesajAdedi === 500 && sentWa[0]!.fiyatTL === 250, '500 wa fiyat')
    assert(sentWa[0]!.requestingTenantId === tenantId, 'wa requesting tenant')
    assert(sentWa[0]!.senderUsed === configuredSender, 'wa sender config tenant')
    assert(sentWa[0]!.senderUsed !== tenantId || configuredSender === tenantId, 'wa sender ≠ talep tenant (config)')
    if (otherTenant) {
      assert(sentWa[0]!.senderUsed !== otherTenant.id, 'wa yanlış other tenant değil')
    }
    assert((await getBalance(tenantId)) === balBeforeAll, 'kredi değişmedi (500 create)')
    ok('yeni 500 → 1 mail + 1 WhatsApp attempt')

    const dup = await createWhatsAppMesajPaketTalebi({
      tenantId,
      userId: user!.id,
      packageId: 'wa_msg_500'
    })
    assert(dup.alreadyExists === true, 'duplicate')
    assert(dup.talep.paymentReference === t500.talep.paymentReference, 'dup aynı ref')
    await flushAdminWhatsAppPaketTalepNotificationsForTests()
    assert(sentMail.length === 1 && sentWa.length === 1, 'duplicate → 0 yeni bildirim')
    ok('duplicate BEKLIYOR → 0 mail + 0 WhatsApp')

    const t1000 = await createWhatsAppMesajPaketTalebi({
      tenantId,
      userId: user!.id,
      packageId: 'wa_msg_1000'
    })
    createdIds.push(t1000.talep.id)
    await flushAdminWhatsAppPaketTalepNotificationsForTests()
    assert(sentMail.length === 2 && sentWa.length === 2, '1000 → +1+1')
    assert(sentWa[1]!.mesajAdedi === 1000 && sentWa[1]!.fiyatTL === 400, '1000 wa fiyat')
    ok('yeni 1000 → 1 mail + 1 WhatsApp')

    // WhatsApp fail → talep oluşur
    failWaNext = true
    const balBeforeWaFail = await getBalance(tenantId)
    const tWaFail = await createWhatsAppMesajPaketTalebi({
      tenantId,
      userId: user!.id,
      packageId: 'wa_msg_2500'
    })
    createdIds.push(tWaFail.talep.id)
    await flushAdminWhatsAppPaketTalepNotificationsForTests()
    assert(tWaFail.talep.durum === 'BEKLIYOR', 'wa fail talep BEKLIYOR')
    assert((await getBalance(tenantId)) === balBeforeWaFail, 'wa fail kredi aynı')
    const waAudit = await prisma.adminAuditLog.findFirst({
      where: {
        action: 'WHATSAPP_PAKET_TALEP_ADMIN_WA_FAILED',
        entityId: tWaFail.talep.id
      }
    })
    assert(Boolean(waAudit), 'wa fail audit')
    ok('WhatsApp fail → talep BEKLIYOR + kredi aynı')

    // SMTP fail → talep oluşur (önce 2500 temizle — zaten BEKLIYOR; 5000 kullan)
    await prisma.whatsAppMesajPaketTalebi.updateMany({
      where: { tenantId, packageId: 'wa_msg_5000', durum: WhatsAppMesajPaketTalepDurum.BEKLIYOR },
      data: { durum: WhatsAppMesajPaketTalepDurum.IPTAL, adminNotu: `${TAG} clean-5k` }
    })
    failMailNext = true
    const tMailFail = await createWhatsAppMesajPaketTalebi({
      tenantId,
      userId: user!.id,
      packageId: 'wa_msg_5000'
    })
    createdIds.push(tMailFail.talep.id)
    await flushAdminWhatsAppPaketTalepNotificationsForTests()
    assert(tMailFail.talep.durum === 'BEKLIYOR', 'smtp fail talep')
    const mailAudit = await prisma.adminAuditLog.findFirst({
      where: {
        action: 'WHATSAPP_PAKET_TALEP_ADMIN_MAIL_FAILED',
        entityId: tMailFail.talep.id
      }
    })
    assert(Boolean(mailAudit), 'smtp fail audit')
    ok('SMTP fail → talep BEKLIYOR')

    // İkisi de fail
    await prisma.whatsAppMesajPaketTalebi.update({
      where: { id: tMailFail.talep.id },
      data: { durum: WhatsAppMesajPaketTalepDurum.IPTAL, adminNotu: `${TAG} reopen` }
    })
    // 5000 iptal; yeniden 5000 için temiz
    failMailNext = true
    failWaNext = true
    const both = await createWhatsAppMesajPaketTalebi({
      tenantId,
      userId: user!.id,
      packageId: 'wa_msg_5000'
    })
    createdIds.push(both.talep.id)
    await flushAdminWhatsAppPaketTalepNotificationsForTests()
    assert(both.talep.durum === 'BEKLIYOR', 'both fail talep')
    assert((await getBalance(tenantId)) === balBeforeAll, 'both fail kredi aynı')
    ok('mail+WA fail → talep korunur, kredi düşmez')

    assert(lastSenderUsed === configuredSender, 'son sender config')
    // eslint-disable-next-line no-console
    console.log(`${n} admin bildirim senaryosu geçti.`)
  } finally {
    setAdminWhatsAppPaketTalepMailSenderForTests(null)
    setAdminWhatsAppPaketTalepWaSenderForTests(null)
    await prisma.whatsAppMesajPaketTalebi.deleteMany({
      where: { id: { in: createdIds } }
    })
    await prisma.whatsAppMesajPaketTalebi.deleteMany({
      where: { adminNotu: { contains: TAG } }
    })
    await prisma.adminAuditLog.deleteMany({
      where: {
        action: {
          in: ['WHATSAPP_PAKET_TALEP_ADMIN_MAIL_FAILED', 'WHATSAPP_PAKET_TALEP_ADMIN_WA_FAILED']
        },
        entityId: { in: createdIds }
      }
    })
    await prisma.$disconnect()
  }
}

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  setAdminWhatsAppPaketTalepMailSenderForTests(null)
  setAdminWhatsAppPaketTalepWaSenderForTests(null)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
