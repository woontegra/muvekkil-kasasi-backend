import { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { decryptSecret } from '../lib/secretCrypto.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { isWhatsAppBaglantiConnected } from './connection.public.js'
import { createWabaMessageTemplate, fetchWabaMessageTemplates, normalizeMetaTemplateStatus } from './meta/embeddedSignup.js'
import { getLibraryEntry } from './templateLibrary.catalog.js'

export type CustomTemplateUsageArea =
  | 'VADEDEN_ONCE'
  | 'VADE_GUNU'
  | 'VADE_SONRASI'
  | 'KISMI_ODEME_SONRASI'
  | 'ODEME_ALINDI'
  | 'RANDEVU_HATIRLATMA'
  | 'MANUEL'

export type CustomTemplateSystemField =
  | 'muvekkilAdi'
  | 'dosyaNumarasi'
  | 'taksitTutari'
  | 'kalanTutar'
  | 'vadeTarihi'
  | 'odenenTutar'
  | 'odemeTarihi'
  | 'randevuTarihi'
  | 'randevuSaati'
  | 'buroAdi'
  | 'buroTelefon'

type CustomVarDef = {
  index: number
  systemField: CustomTemplateSystemField
  exampleValue: string
}

type CustomTemplateSnapshot = {
  kind: 'CUSTOM_TEMPLATE'
  displayName: string
  usageArea: CustomTemplateUsageArea
  bodyText: string
  footerText: string | null
  variables: CustomVarDef[]
  metaParamNames: string[]
  metaBodyText: string
  createComponents: Record<string, unknown>[]
}

type CustomTemplateInput = {
  displayName: string
  metaName: string
  usageArea: CustomTemplateUsageArea
  category: 'UTILITY' | 'MARKETING'
  language: 'tr'
  bodyText: string
  footerText?: string | null
  variables: CustomVarDef[]
}

const META_NAME_RE = /^[a-z0-9_]+$/
const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g

function normalizeMetaName(v: string): string {
  const lower = v
    .trim()
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
  return lower.replace(/[^a-z0-9\s_]/g, '').trim().replace(/\s+/g, '_').replace(/_+/g, '_')
}

export function parseCustomTemplateSnapshot(snapshot: Prisma.JsonValue | null): CustomTemplateSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const value = snapshot as Record<string, unknown>
  if (value.kind !== 'CUSTOM_TEMPLATE') return null
  if (!Array.isArray(value.variables) || !Array.isArray(value.metaParamNames)) return null
  return value as unknown as CustomTemplateSnapshot
}

function parseSnapshot(snapshot: Prisma.JsonValue | null): CustomTemplateSnapshot | null {
  return parseCustomTemplateSnapshot(snapshot)
}

function assertCustomDraftMutable(statusNormalized: string): void {
  if (statusNormalized !== 'TASLAK') {
    throw new AppError(
      409,
      'Yalnızca taslak özel şablonlar düzenlenebilir veya silinebilir. Değişiklik için kopya oluşturun.',
      'TEMPLATE_LOCKED'
    )
  }
}

function validateTemplateInput(input: CustomTemplateInput): {
  snapshot: CustomTemplateSnapshot
  sanitizedMetaName: string
} {
  const metaName = normalizeMetaName(input.metaName)
  if (!metaName || !META_NAME_RE.test(metaName)) {
    throw new AppError(422, 'Meta şablon adı yalnızca küçük harf, sayı ve _ içerebilir.', 'INVALID_META_NAME')
  }
  const body = input.bodyText.trim()
  if (!body) {
    throw new AppError(422, 'Mesaj metni zorunludur.', 'BODY_REQUIRED')
  }
  const matches = [...body.matchAll(PLACEHOLDER_RE)].map((m) => Number(m[1]))
  const uniqueSorted = [...new Set(matches)].sort((a, b) => a - b)
  for (let i = 0; i < uniqueSorted.length; i += 1) {
    if (uniqueSorted[i] !== i + 1) {
      throw new AppError(422, 'Değişkenler sıralı olmalı: {{1}}, {{2}}, ...', 'VARIABLE_INDEX_GAP')
    }
  }
  if (uniqueSorted.length !== input.variables.length) {
    throw new AppError(422, 'Mesajdaki değişkenler ile değişken listesi uyuşmuyor.', 'VARIABLE_MISMATCH')
  }
  const byIndex = new Map(input.variables.map((v) => [v.index, v]))
  const metaParamNames: string[] = []
  let metaBodyText = body
  for (let i = 1; i <= uniqueSorted.length; i += 1) {
    const item = byIndex.get(i)
    if (!item) {
      throw new AppError(422, `{{${i}}} değişkeni için alan seçilmelidir.`, 'VARIABLE_DEF_MISSING')
    }
    if (!item.exampleValue?.trim()) {
      throw new AppError(422, `{{${i}}} için örnek değer zorunludur.`, 'VARIABLE_EXAMPLE_REQUIRED')
    }
    const paramName = `p${i}`
    metaParamNames.push(paramName)
    metaBodyText = metaBodyText.split(`{{${i}}}`).join(`{{${paramName}}}`)
  }

  const bodyComponent: Record<string, unknown> = {
    type: 'BODY',
    text: metaBodyText,
    example: {
      body_text_named_params: input.variables
        .sort((a, b) => a.index - b.index)
        .map((v, idx) => ({ param_name: `p${idx + 1}`, example: v.exampleValue.trim() }))
    }
  }
  const components: Record<string, unknown>[] = [bodyComponent]
  const footer = input.footerText?.trim() ?? ''
  if (footer) components.push({ type: 'FOOTER', text: footer.slice(0, 60) })

  return {
    sanitizedMetaName: metaName,
    snapshot: {
      kind: 'CUSTOM_TEMPLATE',
      displayName: input.displayName.trim(),
      usageArea: input.usageArea,
      bodyText: body,
      footerText: footer || null,
      variables: input.variables.sort((a, b) => a.index - b.index),
      metaParamNames,
      metaBodyText,
      createComponents: components
    }
  }
}

function serializeCustomTemplate(row: {
  id: string
  metaName: string
  language: string
  category: string | null
  statusNormalized: string
  rejectionReason: string | null
  submittedAt: Date | null
  approvedAt: Date | null
  createdAt: Date
  lastSyncedAt: Date
  componentsSnapshot: Prisma.JsonValue | null
}) {
  const snapshot = parseSnapshot(row.componentsSnapshot)
  const isDraft = row.statusNormalized === 'TASLAK'
  return {
    id: row.id,
    displayName: snapshot?.displayName ?? row.metaName,
    metaName: row.metaName,
    language: row.language,
    category: row.category ?? 'UTILITY',
    usageArea: snapshot?.usageArea ?? 'MANUEL',
    statusNormalized: row.statusNormalized,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
    bodyText: snapshot?.bodyText ?? '',
    footerText: snapshot?.footerText ?? null,
    variables: snapshot?.variables ?? [],
    isEditable: isDraft,
    isDeletable: isDraft,
    canSubmitToMeta: isDraft
  }
}

export async function listCustomTemplatesForTenant(tenantId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await prisma.whatsAppMetaSablon.findMany({
    where: { tenantId, libraryKey: null },
    orderBy: [{ createdAt: 'desc' }]
  })
  return rows
    .filter((r) => parseSnapshot(r.componentsSnapshot))
    .map((r) => serializeCustomTemplate(r))
}

export async function createCustomTemplateDraft(
  tenantId: string,
  userId: string,
  input: CustomTemplateInput,
  req: Request
): Promise<Record<string, unknown>> {
  const validated = validateTemplateInput(input)
  const duplicate = await prisma.whatsAppMetaSablon.findFirst({
    where: { tenantId, metaName: validated.sanitizedMetaName, language: input.language }
  })
  if (duplicate) {
    throw new AppError(409, 'Aynı isim ve dilde şablon zaten var. `_v2` ile yeni sürüm oluşturabilirsiniz.', 'DUPLICATE_TEMPLATE')
  }
  const row = await prisma.whatsAppMetaSablon.create({
    data: {
      tenantId,
      metaName: validated.sanitizedMetaName,
      language: input.language,
      statusNormalized: 'TASLAK',
      category: input.category,
      componentsSnapshot: validated.snapshot as Prisma.InputJsonValue,
      parameterFormat: 'named',
      lastSyncedAt: new Date()
    }
  })
  const meta = getRequestMeta(req)
  await writeAuditLog({
    tenantId,
    userId,
    action: 'WHATSAPP_CUSTOM_TEMPLATE_DRAFT_CREATED',
    entityType: 'WhatsAppMetaSablon',
    entityId: row.id,
    newValue: { metaName: row.metaName },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
  return serializeCustomTemplate(row)
}

export async function updateCustomTemplateDraft(
  tenantId: string,
  userId: string,
  id: string,
  input: CustomTemplateInput,
  req: Request
): Promise<Record<string, unknown>> {
  const row = await prisma.whatsAppMetaSablon.findFirst({ where: { id, tenantId, libraryKey: null } })
  if (!row) throw new AppError(404, 'Şablon bulunamadı.', 'TEMPLATE_NOT_FOUND')
  if (!parseSnapshot(row.componentsSnapshot)) {
    throw new AppError(422, 'Yalnızca özel şablonlar güncellenebilir.', 'TEMPLATE_NOT_CUSTOM')
  }
  assertCustomDraftMutable(row.statusNormalized)

  const validated = validateTemplateInput(input)
  const duplicate = await prisma.whatsAppMetaSablon.findFirst({
    where: {
      tenantId,
      metaName: validated.sanitizedMetaName,
      language: input.language,
      NOT: { id: row.id }
    }
  })
  if (duplicate) {
    throw new AppError(409, 'Aynı isim ve dilde şablon zaten var. `_v2` ile yeni sürüm oluşturabilirsiniz.', 'DUPLICATE_TEMPLATE')
  }

  const updated = await prisma.whatsAppMetaSablon.update({
    where: { id: row.id },
    data: {
      metaName: validated.sanitizedMetaName,
      category: input.category,
      componentsSnapshot: validated.snapshot as Prisma.InputJsonValue,
      lastSyncedAt: new Date()
    }
  })

  const meta = getRequestMeta(req)
  await writeAuditLog({
    tenantId,
    userId,
    action: 'WHATSAPP_CUSTOM_TEMPLATE_DRAFT_UPDATED',
    entityType: 'WhatsAppMetaSablon',
    entityId: updated.id,
    newValue: { metaName: updated.metaName },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
  return serializeCustomTemplate(updated)
}

export async function deleteCustomTemplateDraft(
  tenantId: string,
  userId: string,
  id: string,
  req: Request
): Promise<{ ok: true; deletedId: string }> {
  const row = await prisma.whatsAppMetaSablon.findFirst({ where: { id, tenantId, libraryKey: null } })
  if (!row) throw new AppError(404, 'Şablon bulunamadı.', 'TEMPLATE_NOT_FOUND')
  if (!parseSnapshot(row.componentsSnapshot)) {
    throw new AppError(422, 'Yalnızca özel şablonlar silinebilir.', 'TEMPLATE_NOT_CUSTOM')
  }
  assertCustomDraftMutable(row.statusNormalized)

  await prisma.whatsAppMetaSablon.delete({ where: { id: row.id } })

  const meta = getRequestMeta(req)
  await writeAuditLog({
    tenantId,
    userId,
    action: 'WHATSAPP_CUSTOM_TEMPLATE_DRAFT_DELETED',
    entityType: 'WhatsAppMetaSablon',
    entityId: row.id,
    oldValue: { metaName: row.metaName },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
  return { ok: true, deletedId: row.id }
}

async function nextVersionedMetaName(tenantId: string, seed: string, language: string): Promise<string> {
  const base = normalizeMetaName(seed)
  if (!base) return 'ozel_sablon'
  const existing = await prisma.whatsAppMetaSablon.findMany({
    where: { tenantId, language, metaName: { startsWith: base } },
    select: { metaName: true }
  })
  if (!existing.some((e) => e.metaName === base)) return base
  let i = 2
  while (existing.some((e) => e.metaName === `${base}_v${i}`)) i += 1
  return `${base}_v${i}`
}

export async function duplicateTemplateAsDraft(
  tenantId: string,
  userId: string,
  id: string,
  req: Request
): Promise<Record<string, unknown>> {
  const row = await prisma.whatsAppMetaSablon.findFirst({ where: { id, tenantId } })
  if (!row) throw new AppError(404, 'Şablon bulunamadı.', 'TEMPLATE_NOT_FOUND')
  let input: CustomTemplateInput | null = null
  if (row.libraryKey) {
    const entry = getLibraryEntry(row.libraryKey)
    if (!entry) throw new AppError(404, 'Hazır şablon bulunamadı.', 'LIBRARY_KEY_UNKNOWN')
    const vars = entry.variables.map((v, idx) => ({
      index: idx + 1,
      systemField: (v === 'dosyaBilgisi' ? 'dosyaNumarasi' : v) as CustomTemplateSystemField,
      exampleValue: String(entry.exampleValues[v] ?? 'örnek')
    }))
    let bodyText = entry.bodyAppText
    entry.variables.forEach((v, idx) => {
      bodyText = bodyText.split(`{${v}}`).join(`{{${idx + 1}}}`)
    })
    input = {
      displayName: `${entry.displayName} (Kopya)`,
      metaName: await nextVersionedMetaName(tenantId, `${entry.metaTemplateName}_v2`, 'tr'),
      usageArea: 'MANUEL',
      category: entry.category,
      language: 'tr',
      bodyText,
      variables: vars
    }
  } else {
    const snap = parseSnapshot(row.componentsSnapshot)
    if (!snap) throw new AppError(422, 'Şablon içeriği okunamadı.', 'TEMPLATE_SNAPSHOT_INVALID')
    input = {
      displayName: `${snap.displayName} (Kopya)`,
      metaName: await nextVersionedMetaName(tenantId, row.metaName, row.language),
      usageArea: snap.usageArea,
      category: (row.category as 'UTILITY' | 'MARKETING') ?? 'UTILITY',
      language: 'tr',
      bodyText: snap.bodyText,
      footerText: snap.footerText,
      variables: snap.variables
    }
  }
  return createCustomTemplateDraft(tenantId, userId, input, req)
}

export async function duplicateLibraryTemplateAsDraft(
  tenantId: string,
  userId: string,
  libraryKey: string,
  req: Request
): Promise<Record<string, unknown>> {
  const entry = getLibraryEntry(libraryKey)
  if (!entry) throw new AppError(404, 'Hazır şablon bulunamadı.', 'LIBRARY_KEY_UNKNOWN')
  const vars = entry.variables.map((v, idx) => ({
    index: idx + 1,
    systemField: (v === 'dosyaBilgisi' ? 'dosyaNumarasi' : v) as CustomTemplateSystemField,
    exampleValue: String(entry.exampleValues[v] ?? 'örnek')
  }))
  let bodyText = entry.bodyAppText
  entry.variables.forEach((v, idx) => {
    bodyText = bodyText.split(`{${v}}`).join(`{{${idx + 1}}}`)
  })
  return createCustomTemplateDraft(
    tenantId,
    userId,
    {
      displayName: `${entry.displayName} (Kopya)`,
      metaName: await nextVersionedMetaName(tenantId, `${entry.metaTemplateName}_v2`, 'tr'),
      usageArea: 'MANUEL',
      category: entry.category,
      language: 'tr',
      bodyText,
      variables: vars
    },
    req
  )
}

export async function submitCustomTemplateToMeta(
  tenantId: string,
  userId: string,
  id: string,
  req: Request,
  deps?: { fetchImpl?: typeof fetch }
): Promise<Record<string, unknown>> {
  const row = await prisma.whatsAppMetaSablon.findFirst({ where: { id, tenantId, libraryKey: null } })
  if (!row) throw new AppError(404, 'Şablon bulunamadı.', 'TEMPLATE_NOT_FOUND')
  if (row.statusNormalized !== 'TASLAK') {
    throw new AppError(422, 'Sadece taslak şablon Meta onayına gönderilebilir.', 'TEMPLATE_NOT_SUBMITTABLE')
  }
  const snap = parseSnapshot(row.componentsSnapshot)
  if (!snap) throw new AppError(422, 'Şablon içeriği okunamadı.', 'TEMPLATE_SNAPSHOT_INVALID')

  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  if (!baglanti || !isWhatsAppBaglantiConnected(baglanti.durum) || !baglanti.wabaId || !baglanti.accessTokenEncrypted) {
    throw new AppError(422, 'Aktif WhatsApp bağlantısı yok.', 'WHATSAPP_NOT_CONNECTED')
  }
  const token = decryptSecret(baglanti.accessTokenEncrypted)
  const fetched = await fetchWabaMessageTemplates(baglanti.wabaId, token, deps?.fetchImpl)
  if (fetched.ok) {
    const remote = fetched.templates.find((t) => t.name === row.metaName && t.language === row.language)
    if (remote) {
      throw new AppError(409, 'Bu isim ve dilde şablon WABA içinde zaten var.', 'DUPLICATE_TEMPLATE')
    }
  }
  await prisma.whatsAppMetaSablon.update({
    where: { id: row.id },
    data: { statusNormalized: 'GONDERILIYOR', lastSyncedAt: new Date() }
  })

  const payload = {
    name: row.metaName,
    language: row.language,
    category: row.category ?? 'UTILITY',
    parameter_format: row.parameterFormat ?? 'named',
    components: snap.createComponents
  }
  const created = await createWabaMessageTemplate({
    wabaId: baglanti.wabaId,
    accessToken: token,
    payload,
    fetchImpl: deps?.fetchImpl
  })
  if (!created.ok && !created.alreadyExists) {
    await prisma.whatsAppMetaSablon.update({
      where: { id: row.id },
      data: { statusNormalized: 'TASLAK', lastSyncedAt: new Date() }
    })
    throw new AppError(502, 'Meta şablon oluşturulamadı.', 'META_TEMPLATE_CREATE_FAILED')
  }

  const normalized = created.ok ? normalizeMetaTemplateStatus(created.status) : 'BEKLIYOR'
  const now = new Date()
  const updated = await prisma.whatsAppMetaSablon.update({
    where: { id: row.id },
    data: {
      baglantiId: baglanti.id,
      providerWabaId: baglanti.wabaId,
      metaTemplateId: created.ok ? created.id : undefined,
      statusNormalized: normalized === 'ONAYLANDI' ? 'ONAYLANDI' : 'BEKLIYOR',
      submittedAt: now,
      approvedAt: normalized === 'ONAYLANDI' ? now : null,
      rejectionReason: null,
      lastSyncedAt: now
    }
  })
  const meta = getRequestMeta(req)
  await writeAuditLog({
    tenantId,
    userId,
    action: 'WHATSAPP_CUSTOM_TEMPLATE_SUBMITTED',
    entityType: 'WhatsAppMetaSablon',
    entityId: updated.id,
    newValue: { metaName: updated.metaName, statusNormalized: updated.statusNormalized },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
  return serializeCustomTemplate(updated)
}
