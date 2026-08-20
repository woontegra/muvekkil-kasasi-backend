/**
 * Read-only diagnosis: local BEKLIYOR library templates vs live Graph message_templates.
 * Never POSTs templates. Never logs tokens.
 *
 * Usage: npx tsx scripts/diagnose-wa-template-ghost.ts
 */
import { prisma } from '../src/lib/prisma.js'
import { decryptSecret } from '../src/lib/secretCrypto.js'
import { graphFetch } from '../src/tahsilatBildirim/meta/graphClient.js'

const TARGET_KEYS = ['TAHSILAT_VADE_ONCESI', 'TAHSILAT_VADE_GUNU', 'RANDEVU_HATIRLATMA'] as const
const TARGET_NAMES = [
  'mk_tahsilat_vade_oncesi_v1',
  'mk_tahsilat_vade_gunu_v1',
  'mk_randevu_hatirlatma_v1'
] as const

function maskId(id: string | null | undefined): string {
  if (!id) return '(yok)'
  const t = id.trim()
  if (t.length <= 6) return `***${t}`
  return `***${t.slice(-6)}`
}

function maskPhone(p: string | null | undefined): string {
  if (!p) return '(yok)'
  const d = p.replace(/\D/g, '')
  if (d.length < 4) return '***'
  return `***${d.slice(-4)}`
}

type MetaTpl = {
  id: string | null
  name: string
  language: string
  status: string
  category: string | null
  rejected_reason: string | null
}

async function fetchAllTemplates(
  wabaId: string,
  token: string
): Promise<{ ok: boolean; templates: MetaTpl[]; pages: number; errorSummary: string | null }> {
  const templates: MetaTpl[] = []
  let after: string | undefined
  let pages = 0
  for (;;) {
    pages += 1
    const query: Record<string, string> = {
      fields: 'id,name,language,status,category,rejected_reason',
      limit: '100'
    }
    if (after) query.after = after
    const result = await graphFetch<{
      data?: Array<{
        id?: string
        name?: string
        language?: string
        status?: string
        category?: string
        rejected_reason?: string
      }>
      paging?: { cursors?: { after?: string }; next?: string }
    }>(`${encodeURIComponent(wabaId)}/message_templates`, {
      method: 'GET',
      accessToken: token,
      query
    })
    if (!result.ok) {
      return { ok: false, templates, pages, errorSummary: result.errorSummary }
    }
    for (const t of result.data?.data ?? []) {
      if (!t.name || !t.language) continue
      templates.push({
        id: t.id?.trim() || null,
        name: t.name,
        language: t.language,
        status: t.status ?? 'PENDING',
        category: t.category ?? null,
        rejected_reason: t.rejected_reason ?? null
      })
    }
    const nextAfter = result.data?.paging?.cursors?.after
    if (!nextAfter || !result.data?.paging?.next) break
    after = nextAfter
    if (pages > 50) break
  }
  return { ok: true, templates, pages, errorSummary: null }
}

async function main(): Promise<void> {
  const local = await prisma.whatsAppMetaSablon.findMany({
    where: {
      OR: [
        { libraryKey: { in: [...TARGET_KEYS] } },
        { metaName: { in: [...TARGET_NAMES] } }
      ],
      statusNormalized: { in: ['BEKLIYOR', 'GONDERILIYOR', 'PENDING'] }
    },
    orderBy: { updatedAt: 'desc' }
  })

  console.log('=== Yerel BEKLIYOR/GONDERILIYOR aday kayıtları ===')
  console.log(`adet=${local.length}`)

  const tenantIds = [...new Set(local.map((r) => r.tenantId))]
  if (tenantIds.length === 0) {
    // Fallback: any connected tenant with those library keys regardless of status
    const any = await prisma.whatsAppMetaSablon.findMany({
      where: {
        OR: [{ libraryKey: { in: [...TARGET_KEYS] } }, { metaName: { in: [...TARGET_NAMES] } }]
      },
      orderBy: { updatedAt: 'desc' },
      take: 20
    })
    console.log('Pending yok; son ilgili kayıtlar:', any.length)
    for (const r of any) {
      console.log({
        id: r.id,
        tenantId: r.tenantId,
        libraryKey: r.libraryKey,
        metaName: r.metaName,
        language: r.language,
        statusNormalized: r.statusNormalized,
        metaTemplateId: r.metaTemplateId,
        providerWabaIdMasked: maskId(r.providerWabaId),
        submittedAt: r.submittedAt,
        lastSyncedAt: r.lastSyncedAt
      })
    }
    const bags = await prisma.whatsAppBaglanti.findMany({
      where: { durum: 'BAGLI' },
      take: 10
    })
    console.log('Aktif BAGLI bağlantı sayısı:', bags.length)
    for (const b of bags) {
      console.log({
        tenantId: b.tenantId,
        baglantiId: b.id,
        verifiedName: b.verifiedName,
        phoneMasked: maskPhone(b.displayPhoneNumber),
        wabaMasked: maskId(b.wabaId),
        hasToken: Boolean(b.accessTokenEncrypted),
        credentialSource: 'WhatsAppBaglanti.accessTokenEncrypted (tenant)'
      })
    }
    return
  }

  for (const tenantId of tenantIds) {
    const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
    console.log('\n=== Tenant bağlantısı ===')
    console.log({
      tenantId,
      baglantiId: baglanti?.id ?? null,
      durum: baglanti?.durum ?? null,
      verifiedName: baglanti?.verifiedName ?? null,
      phoneMasked: maskPhone(baglanti?.displayPhoneNumber),
      wabaMasked: maskId(baglanti?.wabaId),
      hasEncryptedToken: Boolean(baglanti?.accessTokenEncrypted),
      credentialSource: 'tenant WhatsAppBaglanti.accessTokenEncrypted (decrypt at runtime)'
    })

    const rows = local.filter((r) => r.tenantId === tenantId)
    console.log('\n=== Yerel şablon kayıtları ===')
    for (const r of rows) {
      console.log({
        id: r.id,
        tenantId: r.tenantId,
        libraryKey: r.libraryKey,
        metaName: r.metaName,
        language: r.language,
        category: r.category,
        statusNormalized: r.statusNormalized,
        metaTemplateId: r.metaTemplateId,
        providerWabaIdMasked: maskId(r.providerWabaId),
        baglantiId: r.baglantiId,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        lastSyncedAt: r.lastSyncedAt.toISOString(),
        rejectionReason: r.rejectionReason
      })
    }

    if (!baglanti?.wabaId || !baglanti.accessTokenEncrypted) {
      console.log('Graph sorgu atlandı: aktif WABA/token yok.')
      continue
    }

    let token: string
    try {
      token = decryptSecret(baglanti.accessTokenEncrypted)
    } catch {
      console.log('Token çözülemedi.')
      continue
    }

    const fetched = await fetchAllTemplates(baglanti.wabaId, token)
    console.log('\n=== Graph API message_templates ===')
    console.log({
      ok: fetched.ok,
      pages: fetched.pages,
      total: fetched.templates.length,
      names: fetched.templates.map((t) => `${t.name}|${t.language}|${t.status}|id=${maskId(t.id)}`),
      errorSummary: fetched.errorSummary
    })

    console.log('\n=== Eşleştirme ===')
    for (const r of rows) {
      const byId = r.metaTemplateId
        ? fetched.templates.find((t) => t.id === r.metaTemplateId)
        : undefined
      const byName = fetched.templates.find(
        (t) => t.name === r.metaName && t.language === r.language
      )
      const hit = byId ?? byName
      console.log({
        localId: r.id,
        metaName: r.metaName,
        classification: hit
          ? 'A_FOUND_ON_ACTIVE_WABA'
          : fetched.ok
            ? 'B_GHOST_NOT_ON_ACTIVE_WABA'
            : 'GRAPH_FAILED',
        matchBy: byId ? 'metaTemplateId' : byName ? 'name+language' : 'none',
        remoteStatus: hit?.status ?? null,
        remoteIdMasked: maskId(hit?.id ?? null)
      })
    }
  }
}

main()
  .catch((e) => {
    console.error('diagnose_failed', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
