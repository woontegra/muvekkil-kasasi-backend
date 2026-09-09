/**
 * Platform Admin WhatsApp paket talebi UTILITY template’ini Meta WABA’da oluşturur.
 * Idempotent: mk_admin_paket_talebi_v1 (tr) varsa yeniden create etmez.
 *
 * Credential: ADMIN_NOTIFICATION_WHATSAPP_TENANT_ID veya Woontegra tenant WhatsAppBaglanti
 * (loadTenantCloudCredentials + baglanti.wabaId). Token hard-code yok.
 *
 *   npx tsx scripts/create-admin-paket-talep-template.ts
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { env } from '../src/config/env.js'
import { decryptSecret } from '../src/lib/secretCrypto.js'
import { isWhatsAppBaglantiConnected } from '../src/tahsilatBildirim/connection.public.js'
import {
  createWabaMessageTemplate,
  fetchWabaMessageTemplates
} from '../src/tahsilatBildirim/meta/embeddedSignup.js'
import { graphFetch, graphVersion } from '../src/tahsilatBildirim/meta/graphClient.js'
import { buildMetaCreateComponentsFromPositionalBody } from '../src/tahsilatBildirim/templateLibrary.components.js'
import { ADMIN_PAKET_TALEP_WA_TEMPLATE_DEFAULT } from '../src/tahsilatBildirim/whatsappMesajPaketTalepAdminWa.js'

const TEMPLATE_NAME = ADMIN_PAKET_TALEP_WA_TEMPLATE_DEFAULT
const LANGUAGE = 'tr'
const CATEGORY = 'UTILITY'

/**
 * Meta: BODY değişkenle bitemez. Kullanıcı metni `Durum: {{4}}` ile bitiyordu;
 * sonuna sabit cümle eklendi (header/footer/button yok).
 */
const BODY_TEXT = [
  'Yeni WhatsApp mesaj paketi talebi',
  '',
  'Büro: {{1}}',
  'Paket: {{2}} mesaj',
  'Tutar: {{3}}',
  'Durum: {{4}}',
  '',
  'Platform Admin panelinden kontrol edebilirsiniz.'
].join('\n')

const BODY_EXAMPLES = ['Woontegra', '500', '250 TL', 'Bekliyor'] as const

function maskId(id: string | null | undefined): string {
  if (!id) return '(yok)'
  const t = id.trim()
  if (t.length <= 6) return `***${t}`
  return `***${t.slice(-6)}`
}

async function resolveSenderTenant(): Promise<{
  tenantId: string
  buroAdi: string
  source: string
}> {
  const configured = env.ADMIN_NOTIFICATION_WHATSAPP_TENANT_ID?.trim()
  if (configured) {
    const t = await prisma.tenant.findUnique({
      where: { id: configured },
      select: { id: true, buroAdi: true }
    })
    if (!t) throw new Error(`ADMIN_NOTIFICATION_WHATSAPP_TENANT_ID bulunamadı: ${configured}`)
    return { tenantId: t.id, buroAdi: t.buroAdi, source: 'ADMIN_NOTIFICATION_WHATSAPP_TENANT_ID' }
  }

  const t = await prisma.tenant.findFirst({
    where: {
      OR: [
        { slug: { equals: 'woontegra', mode: 'insensitive' } },
        { buroAdi: { equals: 'Woontegra', mode: 'insensitive' } },
        { buroAdi: { contains: 'Woontegra', mode: 'insensitive' } }
      ]
    },
    select: { id: true, buroAdi: true },
    orderBy: { createdAt: 'asc' }
  })
  if (!t) throw new Error('Woontegra tenant bulunamadı (slug/buroAdi).')
  return { tenantId: t.id, buroAdi: t.buroAdi, source: 'woontegra_lookup' }
}

async function loadWabaCreds(tenantId: string): Promise<{
  wabaId: string
  accessToken: string
  phoneNumberIdMasked: string
}> {
  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  if (!baglanti || !isWhatsAppBaglantiConnected(baglanti.durum)) {
    throw new Error('Tenant WhatsApp bağlantısı yok veya aktif değil.')
  }
  if (!baglanti.wabaId?.trim()) throw new Error('baglanti.wabaId eksik.')
  if (!baglanti.accessTokenEncrypted) throw new Error('accessTokenEncrypted eksik.')
  if (!baglanti.phoneNumberId) throw new Error('phoneNumberId eksik.')

  const accessToken = decryptSecret(baglanti.accessTokenEncrypted)
  return {
    wabaId: baglanti.wabaId.trim(),
    accessToken,
    phoneNumberIdMasked: maskId(baglanti.phoneNumberId)
  }
}

async function fetchTemplateDetail(
  wabaId: string,
  accessToken: string,
  name: string,
  language: string
): Promise<{
  id: string | null
  name: string
  language: string
  status: string | null
  category: string | null
  bodyText: string | null
} | null> {
  const result = await graphFetch<{
    data?: Array<{
      id?: string
      name?: string
      language?: string
      status?: string
      category?: string
      components?: Array<{ type?: string; text?: string }>
    }>
  }>(`${encodeURIComponent(wabaId)}/message_templates`, {
    method: 'GET',
    accessToken,
    query: {
      fields: 'id,name,language,status,category,components',
      name,
      limit: '50'
    },
    version: graphVersion()
  })

  if (!result.ok) {
    // Liste fallback
    const listed = await fetchWabaMessageTemplates(wabaId, accessToken)
    if (!listed.ok) return null
    const hit = listed.templates.find((t) => t.name === name && t.language === language)
    if (!hit) return null
    return {
      id: hit.id,
      name: hit.name,
      language: hit.language,
      status: hit.status,
      category: hit.category,
      bodyText: null
    }
  }

  const hit = (result.data?.data ?? []).find(
    (t) => t.name === name && (t.language === language || !language)
  )
  if (!hit) return null
  const body = (hit.components ?? []).find((c) => String(c.type ?? '').toUpperCase() === 'BODY')
  return {
    id: hit.id?.trim() || null,
    name: hit.name ?? name,
    language: hit.language ?? language,
    status: hit.status ?? null,
    category: hit.category ?? null,
    bodyText: body?.text ?? null
  }
}

function printReport(opts: {
  mode: 'EXISTS' | 'CREATED' | 'FAILED'
  templateName: string
  templateId: string | null
  status: string | null
  category: string | null
  language: string
  body: string | null
  wabaId: string
  tenantLabel: string
  error?: unknown
}): void {
  // eslint-disable-next-line no-console
  console.log('\n=== Admin paket talep template ===')
  // eslint-disable-next-line no-console
  console.log('mode:', opts.mode)
  // eslint-disable-next-line no-console
  console.log('template name:', opts.templateName)
  // eslint-disable-next-line no-console
  console.log('template id:', opts.templateId ?? '(yok)')
  // eslint-disable-next-line no-console
  console.log('status:', opts.status ?? '(yok)')
  // eslint-disable-next-line no-console
  console.log('category:', opts.category ?? '(yok)')
  // eslint-disable-next-line no-console
  console.log('language:', opts.language)
  // eslint-disable-next-line no-console
  console.log('WABA id:', opts.wabaId, `(masked ${maskId(opts.wabaId)})`)
  // eslint-disable-next-line no-console
  console.log('tenant:', opts.tenantLabel)
  // eslint-disable-next-line no-console
  console.log('exact BODY:\n---\n' + (opts.body ?? '(bilinmiyor)') + '\n---')
  if (opts.error) {
    // eslint-disable-next-line no-console
    console.log('error:', typeof opts.error === 'string' ? opts.error : JSON.stringify(opts.error, null, 2))
  }
}

async function main(): Promise<void> {
  const tenant = await resolveSenderTenant()
  const creds = await loadWabaCreds(tenant.tenantId)

  // eslint-disable-next-line no-console
  console.log('Sender tenant:', tenant.buroAdi, tenant.tenantId, `(${tenant.source})`)
  // eslint-disable-next-line no-console
  console.log('WABA:', maskId(creds.wabaId), 'phone:', creds.phoneNumberIdMasked)
  // eslint-disable-next-line no-console
  console.log('Looking for template:', TEMPLATE_NAME, LANGUAGE)

  const existing = await fetchTemplateDetail(
    creds.wabaId,
    creds.accessToken,
    TEMPLATE_NAME,
    LANGUAGE
  )

  if (existing) {
    printReport({
      mode: 'EXISTS',
      templateName: existing.name,
      templateId: existing.id,
      status: existing.status,
      category: existing.category,
      language: existing.language,
      body: existing.bodyText,
      wabaId: creds.wabaId,
      tenantLabel: `${tenant.buroAdi} (${tenant.tenantId})`
    })
    await prisma.$disconnect()
    return
  }

  const built = buildMetaCreateComponentsFromPositionalBody({
    bodyText: BODY_TEXT,
    examples: [...BODY_EXAMPLES],
    footerText: null,
    enforceVariableEdges: true
  })
  if (!built.ok) {
    printReport({
      mode: 'FAILED',
      templateName: TEMPLATE_NAME,
      templateId: null,
      status: null,
      category: CATEGORY,
      language: LANGUAGE,
      body: BODY_TEXT,
      wabaId: creds.wabaId,
      tenantLabel: `${tenant.buroAdi} (${tenant.tenantId})`,
      error: { code: built.code, message: built.message }
    })
    await prisma.$disconnect()
    process.exit(1)
  }

  const payload: Record<string, unknown> = {
    name: TEMPLATE_NAME,
    language: LANGUAGE,
    category: CATEGORY,
    components: built.components
  }

  // eslint-disable-next-line no-console
  console.log('Creating template on Meta…')
  const created = await createWabaMessageTemplate({
    wabaId: creds.wabaId,
    accessToken: creds.accessToken,
    payload
  })

  if (!created.ok) {
    printReport({
      mode: 'FAILED',
      templateName: TEMPLATE_NAME,
      templateId: null,
      status: null,
      category: CATEGORY,
      language: LANGUAGE,
      body: BODY_TEXT,
      wabaId: creds.wabaId,
      tenantLabel: `${tenant.buroAdi} (${tenant.tenantId})`,
      error: {
        alreadyExists: created.alreadyExists,
        errorCode: created.errorCode,
        errorDetails: created.errorDetails,
        errorSummary: created.errorSummary
      }
    })
    await prisma.$disconnect()
    process.exit(1)
  }

  // Create sonrası detay (body doğrulama)
  const after = await fetchTemplateDetail(
    creds.wabaId,
    creds.accessToken,
    TEMPLATE_NAME,
    LANGUAGE
  )

  printReport({
    mode: 'CREATED',
    templateName: TEMPLATE_NAME,
    templateId: after?.id ?? created.id,
    status: after?.status ?? created.status,
    category: after?.category ?? CATEGORY,
    language: after?.language ?? LANGUAGE,
    body: after?.bodyText ?? BODY_TEXT,
    wabaId: creds.wabaId,
    tenantLabel: `${tenant.buroAdi} (${tenant.tenantId})`
  })

  await prisma.$disconnect()
}

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error('FATAL:', e instanceof Error ? e.message : e)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
