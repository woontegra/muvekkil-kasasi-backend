/**
 * One-shot: resolve Woontegra tenant → import-existing-connection (same as admin POST).
 * No outbound message / webhook override / subscribed_apps / register.
 * Token never logged.
 */
import 'dotenv/config'
import type { Request } from 'express'
import { prisma } from '../src/lib/prisma.js'
import { importExistingMetaConnection } from '../src/tahsilatBildirim/connection.importExisting.js'

const WABA_ID = '420529479291363'
const PHONE_NUMBER_ID = '525890038336054'

function fakeReq(): Request {
  return {
    headers: { 'user-agent': 'whatsapp-import-existing-oneshot' },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' }
  } as unknown as Request
}

async function resolveWoontegraTenantCandidates() {
  const bySlug = await prisma.tenant.findMany({
    where: { slug: { equals: 'woontegra', mode: 'insensitive' } },
    select: { id: true, slug: true, buroAdi: true, aktifMi: true, createdAt: true }
  })
  const byName = await prisma.tenant.findMany({
    where: {
      OR: [
        { buroAdi: { equals: 'Woontegra', mode: 'insensitive' } },
        { buroAdi: { contains: 'Woontegra', mode: 'insensitive' } }
      ]
    },
    select: { id: true, slug: true, buroAdi: true, aktifMi: true, createdAt: true }
  })
  const map = new Map<string, (typeof bySlug)[number]>()
  for (const t of [...bySlug, ...byName]) map.set(t.id, t)
  return [...map.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

async function main() {
  const tokenSet = Boolean(process.env.WHATSAPP_WOONTEGRA_SYSTEM_USER_TOKEN?.trim())
  if (!tokenSet) {
    console.log(JSON.stringify({ ok: false, code: 'CONFIG_MISSING', message: 'WHATSAPP_WOONTEGRA_SYSTEM_USER_TOKEN missing' }))
    process.exit(2)
  }

  const candidates = await resolveWoontegraTenantCandidates()
  if (candidates.length === 0) {
    console.log(JSON.stringify({ ok: false, code: 'TENANT_NOT_FOUND', candidates: [] }, null, 2))
    process.exit(1)
  }
  if (candidates.length > 1) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          code: 'AMBIGUOUS_TENANT',
          message: 'Birden fazla Woontegra adayı; yazma yapılmadı.',
          candidates: candidates.map((c) => ({
            tenantId: c.id,
            slug: c.slug,
            buroAdi: c.buroAdi,
            aktifMi: c.aktifMi
          }))
        },
        null,
        2
      )
    )
    process.exit(3)
  }

  const tenant = candidates[0]!
  // Prefer exact slug match when present among unique set (already unique)
  const exactSlug = candidates.find((c) => c.slug.toLowerCase() === 'woontegra')
  const chosen = exactSlug ?? tenant

  const admin = await prisma.superAdmin.findFirst({
    where: { aktifMi: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, eposta: true }
  })
  if (!admin) {
    console.log(JSON.stringify({ ok: false, code: 'NO_SUPER_ADMIN', message: 'Aktif SuperAdmin yok' }))
    process.exit(1)
  }

  // Same code path as POST /api/v1/admin/whatsapp/import-existing-connection
  const publicStatus = await importExistingMetaConnection(
    admin.id,
    { tenantId: chosen.id, wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID },
    fakeReq()
  )

  const row = await prisma.whatsAppBaglanti.findUnique({
    where: { tenantId: chosen.id },
    select: {
      id: true,
      tenantId: true,
      durum: true,
      wabaId: true,
      phoneNumberId: true,
      displayPhoneNumber: true,
      verifiedName: true,
      webhookOverrideActive: true,
      webhookOverrideCallback: true,
      connectedAt: true
    }
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        routeEquivalent: 'POST /api/v1/admin/whatsapp/import-existing-connection',
        tenantId: chosen.id,
        tenantSlug: chosen.slug,
        tenantBuroAdi: chosen.buroAdi,
        wabaId: row?.wabaId ?? null,
        phoneNumberId: row?.phoneNumberId ?? null,
        connectionId: row?.id ?? null,
        durum: row?.durum ?? null,
        aktif: row?.durum === 'BAGLI' || row?.durum === 'ACTIVE',
        sharedWebhookTestConnection: publicStatus.sharedWebhookTestConnection === true,
        webhookOverrideActive: row?.webhookOverrideActive ?? null,
        webhookOverrideCallback: row?.webhookOverrideCallback ?? null,
        displayPhoneNumber: row?.displayPhoneNumber ?? null,
        verifiedName: row?.verifiedName ?? null,
        connectedAt: row?.connectedAt?.toISOString() ?? null,
        messageSent: false,
        outboundTest: 'awaiting explicit approval'
      },
      null,
      2
    )
  )
}

main()
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    const code = (e as { code?: string })?.code
    console.log(JSON.stringify({ ok: false, code: code ?? 'IMPORT_FAILED', message: msg }))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
