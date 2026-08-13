/**
 * One-shot controlled session Cloud text send (explicit user approval).
 * Does not print raw phone or message body.
 */
import 'dotenv/config'
import type { Request } from 'express'
import { prisma } from '../src/lib/prisma.js'
import { sendControlledSessionCloudTextTest } from '../src/tahsilatBildirim/connection.controlledSessionTest.js'
import { maskPhone } from '../src/tahsilatBildirim/phone.js'

const TENANT_ID = 'c433539d-fae3-4419-a6d8-9f1b59464d61'
const CONNECTION_ID = '159a0c71-3344-4b29-a14f-2df0c70f5fb5'
const TO = process.env.CONTROLLED_TEST_TO?.trim() || ''

function fakeReq(): Request {
  return {
    headers: { 'user-agent': 'controlled-session-test-oneshot' },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' }
  } as unknown as Request
}

async function main() {
  if (!TO) {
    console.log(JSON.stringify({ ok: false, code: 'MISSING_TO' }))
    process.exit(2)
  }

  const before = await prisma.whatsAppBaglanti.findUnique({
    where: { id: CONNECTION_ID },
    select: {
      id: true,
      tenantId: true,
      durum: true,
      wabaId: true,
      phoneNumberId: true,
      webhookOverrideActive: true,
      webhookOverrideCallback: true
    }
  })
  if (!before || before.tenantId !== TENANT_ID) {
    console.log(JSON.stringify({ ok: false, code: 'CONNECTION_MISMATCH' }))
    process.exit(1)
  }
  if (before.webhookOverrideActive) {
    console.log(JSON.stringify({ ok: false, code: 'OVERRIDE_ACTIVE' }))
    process.exit(1)
  }

  const admin = await prisma.superAdmin.findFirst({
    where: { aktifMi: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true }
  })
  if (!admin) {
    console.log(JSON.stringify({ ok: false, code: 'NO_SUPER_ADMIN' }))
    process.exit(1)
  }

  const out = await sendControlledSessionCloudTextTest(
    admin.id,
    { tenantId: TENANT_ID, to: TO, confirm: true },
    fakeReq()
  )

  const after = await prisma.whatsAppBaglanti.findUnique({
    where: { id: CONNECTION_ID },
    select: { webhookOverrideActive: true, webhookOverrideCallback: true }
  })

  const jobId = typeof out.jobId === 'string' ? out.jobId : null
  const job = jobId
    ? await prisma.tahsilatBildirimIsi.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          durum: true,
          providerMessageId: true,
          denemeSayisi: true
        }
      })
    : null
  const deneme = jobId
    ? await prisma.tahsilatBildirimDeneme.findMany({
        where: { isId: jobId },
        select: { id: true, basariliMi: true, mesajOzeti: true, sonucKodu: true },
        orderBy: { createdAt: 'asc' }
      })
    : []

  console.log(
    JSON.stringify(
      {
        ok: out.ok === true,
        idempotent: out.idempotent === true,
        cloudOutboundSuccess:
          out.ok === true &&
          out.durum === 'GONDERILDI' &&
          Boolean(out.providerMessageId),
        providerMessageId: out.providerMessageId ?? null,
        durum: out.durum ?? null,
        jobId,
        connectionId: before.id,
        tenantId: before.tenantId,
        wabaId: before.wabaId,
        phoneNumberId: before.phoneNumberId,
        recipientMasked: maskPhone(TO),
        message: 'MASKED',
        denemeSayisi: deneme.length,
        denemeMesajOzeti: deneme.map((d) => d.mesajOzeti),
        jobDurum: job?.durum ?? null,
        jobProviderMessageId: job?.providerMessageId ?? null,
        webhookOverrideActiveBefore: before.webhookOverrideActive,
        webhookOverrideActiveAfter: after?.webhookOverrideActive ?? null,
        webhookOverrideCallbackAfter: after?.webhookOverrideCallback ?? null,
        automationEnabled: process.env.WHATSAPP_AUTOMATION_ENABLED ?? 'false',
        webhookStatusAsserted: false
      },
      null,
      2
    )
  )
}

main()
  .catch((e) => {
    const code = (e as { code?: string })?.code
    const msg = e instanceof Error ? e.message : String(e)
    console.log(
      JSON.stringify({
        ok: false,
        code: code ?? 'SEND_FAILED',
        message: msg.slice(0, 200)
      })
    )
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
