/**
 * Hazır WhatsApp şablon kütüphanesi — list / Meta’ya gönder / otomasyon eşleme.
 * MailCenter yok; yalnızca tenant WhatsAppBaglanti.
 */
import type { Request } from 'express'
import { Prisma } from '@prisma/client'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { decryptSecret } from '../lib/secretCrypto.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { isWhatsAppBaglantiConnected } from './connection.public.js'
import {
  createWabaMessageTemplate,
  fetchWabaMessageTemplates,
  hasValidMetaTemplateId,
  normalizeMetaTemplateStatus,
  type MetaTemplateRow
} from './meta/embeddedSignup.js'
import {
  TEMPLATE_LIBRARY,
  getLibraryEntry,
  libraryStatusLabel,
  suggestedLibraryKeyForKural,
  type TemplateLibraryKey
} from './templateLibrary.catalog.js'
import {
  buildValidatedMetaCreateTemplatePayload,
  componentsSnapshotForEntry
} from './templateLibrary.components.js'
import { formatSafeMetaCreateErrorMessage, type SafeMetaGraphError } from './meta/graphClient.js'

function accountDisplayName(baglanti: {
  verifiedName: string | null
  businessAccountName: string | null
}): string {
  return (
    baglanti.verifiedName?.trim() ||
    baglanti.businessAccountName?.trim() ||
    'bağlı WhatsApp hesabı'
  )
}

function metaTemplateCreateFailedError(
  baglanti: { verifiedName: string | null; businessAccountName: string | null },
  errorDetails?: SafeMetaGraphError | null
): AppError {
  return new AppError(
    502,
    formatSafeMetaCreateErrorMessage(errorDetails, accountDisplayName(baglanti)),
    'META_TEMPLATE_CREATE_FAILED'
  )
}

function findRemoteTemplate(
  templates: MetaTemplateRow[],
  metaName: string,
  language: string,
  metaTemplateId?: string | null
): MetaTemplateRow | undefined {
  if (hasValidMetaTemplateId(metaTemplateId)) {
    const byId = templates.find((t) => t.id === metaTemplateId)
    if (byId) return byId
  }
  return templates.find((t) => t.name === metaName && t.language === language)
}

function isLibraryGhostPending(row: {
  statusNormalized: string
  metaTemplateId: string | null
}): boolean {
  return (
    (row.statusNormalized === 'BEKLIYOR' || row.statusNormalized === 'GONDERILIYOR') &&
    !hasValidMetaTemplateId(row.metaTemplateId)
  )
}

function serializeMetaRow(row: {
  id: string
  libraryKey: string | null
  metaName: string
  language: string
  statusNormalized: string
  category: string | null
  rejectionReason: string | null
  metaTemplateId: string | null
  providerWabaId: string | null
  submittedAt: Date | null
  approvedAt: Date | null
  lastSyncedAt: Date
}) {
  const ui = libraryStatusLabel(row.statusNormalized)
  return {
    id: row.id,
    libraryKey: row.libraryKey,
    metaName: row.metaName,
    language: row.language,
    statusNormalized: row.statusNormalized,
    statusLabel: ui.label,
    statusCode: ui.code,
    category: row.category,
    rejectionReason: row.rejectionReason,
    metaTemplateId: row.metaTemplateId,
    providerWabaId: row.providerWabaId,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt.toISOString()
  }
}

export async function listTemplateLibraryForTenant(tenantId: string): Promise<{
  catalog: Array<Record<string, unknown>>
  connectionReady: boolean
}> {
  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  const connectionReady = Boolean(
    baglanti && isWhatsAppBaglantiConnected(baglanti.durum) && baglanti.wabaId
  )

  const local = await prisma.whatsAppMetaSablon.findMany({
    where: {
      tenantId,
      OR: [
        { libraryKey: { not: null } },
        { metaName: { in: TEMPLATE_LIBRARY.map((e) => e.metaTemplateName) } }
      ]
    }
  })

  const byKey = new Map<string, (typeof local)[number]>()
  for (const row of local) {
    const key =
      row.libraryKey ||
      TEMPLATE_LIBRARY.find((e) => e.metaTemplateName === row.metaName)?.libraryKey
    if (key) byKey.set(key, row)
  }

  const catalog = TEMPLATE_LIBRARY.map((entry) => {
    const row = byKey.get(entry.libraryKey)
    const ui = libraryStatusLabel(row?.statusNormalized ?? null)
    return {
      libraryKey: entry.libraryKey,
      displayName: entry.displayName,
      shortDescription: entry.shortDescription,
      suggestedUse: entry.suggestedUse,
      templateGroup: entry.templateGroup,
      category: entry.category,
      language: entry.language,
      metaTemplateName: entry.metaTemplateName,
      bodyPreview: entry.bodyAppText,
      variables: entry.variables,
      suggestedKuralTuru: entry.suggestedKuralTuru,
      statusCode: ui.code,
      statusLabel: ui.label,
      rejectionReason: row?.rejectionReason ?? null,
      local: row ? serializeMetaRow(row) : null,
      canSubmitToMeta:
        connectionReady &&
        (!row ||
          row.statusNormalized === 'REDDEDILDI' ||
          isLibraryGhostPending(row)),
      canUseInAutomation: row?.statusNormalized === 'ONAYLANDI'
    }
  })

  return { catalog, connectionReady }
}

export async function submitLibraryTemplateToMeta(
  tenantId: string,
  userId: string,
  libraryKey: string,
  req: Request,
  deps?: { fetchImpl?: typeof fetch }
): Promise<Record<string, unknown>> {
  const entry = getLibraryEntry(libraryKey)
  if (!entry) {
    throw new AppError(404, 'Hazır şablon bulunamadı.', 'LIBRARY_KEY_UNKNOWN')
  }

  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  if (!baglanti || !isWhatsAppBaglantiConnected(baglanti.durum) || !baglanti.wabaId) {
    throw new AppError(
      422,
      'WhatsApp bağlantısı aktif değil. Önce hesabınızı bağlayın.',
      'WHATSAPP_NOT_CONNECTED'
    )
  }
  if (!baglanti.accessTokenEncrypted) {
    throw new AppError(422, 'WhatsApp token bulunamadı.', 'WHATSAPP_NOT_CONNECTED')
  }

  const wabaId = baglanti.wabaId
  const existing = await prisma.whatsAppMetaSablon.findFirst({
    where: {
      tenantId,
      OR: [
        { libraryKey: entry.libraryKey, providerWabaId: wabaId },
        { metaName: entry.metaTemplateName, language: entry.language }
      ]
    }
  })

  if (existing && existing.statusNormalized === 'ONAYLANDI') {
    return {
      ok: true,
      alreadyExists: true,
      template: serializeMetaRow(existing),
      note: 'Bu şablon WABA’da zaten onaylı; yeniden oluşturulmadı.'
    }
  }
  // Gerçek Meta id’si olan incelemede → yeniden create etme.
  // metaTemplateId’siz hayalet BEKLIYOR → yeniden gönderime izin ver.
  if (
    existing &&
    existing.statusNormalized === 'BEKLIYOR' &&
    hasValidMetaTemplateId(existing.metaTemplateId)
  ) {
    return {
      ok: true,
      alreadyExists: true,
      template: serializeMetaRow(existing),
      note: 'Şablon incelemede; yeniden oluşturulmadı.'
    }
  }

  let token: string
  try {
    token = decryptSecret(baglanti.accessTokenEncrypted)
  } catch {
    throw new AppError(500, 'Token çözülemedi.', 'TOKEN_DECRYPT_FAILED')
  }

  const previousStatus = existing?.statusNormalized ?? null

  // Meta’da aynı isim var mı? Sync ile getir (pagination dahil).
  const fetched = await fetchWabaMessageTemplates(wabaId, token, deps?.fetchImpl)
  if (fetched.ok) {
    const remote = findRemoteTemplate(
      fetched.templates,
      entry.metaTemplateName,
      entry.language,
      existing?.metaTemplateId
    )
    if (remote && hasValidMetaTemplateId(remote.id)) {
      const statusNormalized = normalizeMetaTemplateStatus(remote.status)
      const now = new Date()
      const row = await prisma.whatsAppMetaSablon.upsert({
        where: {
          tenantId_metaName_language: {
            tenantId,
            metaName: entry.metaTemplateName,
            language: entry.language
          }
        },
        create: {
          tenantId,
          baglantiId: baglanti.id,
          metaName: entry.metaTemplateName,
          language: entry.language,
          statusNormalized,
          category: remote.category ?? entry.category,
          libraryKey: entry.libraryKey,
          providerWabaId: wabaId,
          metaTemplateId: remote.id,
          rejectionReason: remote.rejectedReason,
          componentsSnapshot: componentsSnapshotForEntry(entry) as Prisma.InputJsonValue,
          parameterFormat: entry.parameterFormat,
          submittedAt: now,
          approvedAt: statusNormalized === 'ONAYLANDI' ? now : null,
          lastSyncedAt: now
        },
        update: {
          baglantiId: baglanti.id,
          statusNormalized,
          category: remote.category ?? entry.category,
          libraryKey: entry.libraryKey,
          providerWabaId: wabaId,
          metaTemplateId: remote.id,
          rejectionReason: remote.rejectedReason,
          componentsSnapshot: componentsSnapshotForEntry(entry) as Prisma.InputJsonValue,
          parameterFormat: entry.parameterFormat,
          approvedAt: statusNormalized === 'ONAYLANDI' ? now : undefined,
          lastSyncedAt: now
        }
      })
      return {
        ok: true,
        alreadyExists: true,
        template: serializeMetaRow(row),
        note: 'Meta’da mevcut şablon bulundu; durum senkronize edildi, yeniden create edilmedi.'
      }
    }
  }

  const validated = buildValidatedMetaCreateTemplatePayload(entry)
  if (!validated.ok) {
    throw new AppError(422, validated.message, validated.code)
  }

  if (existing) {
    await prisma.whatsAppMetaSablon.update({
      where: { id: existing.id },
      data: { statusNormalized: 'GONDERILIYOR', lastSyncedAt: new Date() }
    })
  }

  const created = await createWabaMessageTemplate({
    wabaId,
    accessToken: token,
    payload: validated.payload,
    fetchImpl: deps?.fetchImpl
  })

  async function revertSubmitStatus(): Promise<void> {
    if (!existing) return
    if (
      isLibraryGhostPending({
        statusNormalized: previousStatus ?? 'BEKLIYOR',
        metaTemplateId: existing.metaTemplateId
      })
    ) {
      await prisma.whatsAppMetaSablon.delete({ where: { id: existing.id } }).catch(() => undefined)
      return
    }
    const revertTo = previousStatus === 'REDDEDILDI' ? 'REDDEDILDI' : previousStatus === 'GONDERILIYOR' ? 'REDDEDILDI' : previousStatus ?? 'REDDEDILDI'
    await prisma.whatsAppMetaSablon.update({
      where: { id: existing.id },
      data: { statusNormalized: revertTo, lastSyncedAt: new Date() }
    })
  }

  let metaTemplateId: string | null = null
  let statusNormalized = 'BEKLIYOR'
  let alreadyExists = false

  if (created.ok) {
    if (!hasValidMetaTemplateId(created.id)) {
      await revertSubmitStatus()
      throw metaTemplateCreateFailedError(baglanti, {
        httpStatus: 200,
        code: null,
        type: null,
        error_subcode: null,
        error_user_title: null,
        error_user_msg: 'Meta geçerli bir şablon kimliği döndürmedi.',
        details: null,
        message: 'Missing template id in successful response',
        fbtrace_id: null
      })
    }
    metaTemplateId = created.id!.trim()
    statusNormalized = normalizeMetaTemplateStatus(created.status)
  } else if (created.alreadyExists) {
    const again = await fetchWabaMessageTemplates(wabaId, token, deps?.fetchImpl)
    const remote = again.ok
      ? findRemoteTemplate(again.templates, entry.metaTemplateName, entry.language)
      : undefined
    if (!remote || !hasValidMetaTemplateId(remote.id)) {
      await revertSubmitStatus()
      throw metaTemplateCreateFailedError(baglanti, created.errorDetails)
    }
    metaTemplateId = remote.id
    statusNormalized = normalizeMetaTemplateStatus(remote.status)
    alreadyExists = true
  } else {
    await revertSubmitStatus()
    throw metaTemplateCreateFailedError(baglanti, created.errorDetails)
  }

  if (!hasValidMetaTemplateId(metaTemplateId)) {
    await revertSubmitStatus()
    throw metaTemplateCreateFailedError(baglanti, null)
  }

  const now = new Date()
  const persistedStatus = statusNormalized === 'ONAYLANDI' ? 'ONAYLANDI' : 'BEKLIYOR'
  const row = await prisma.whatsAppMetaSablon.upsert({
    where: {
      tenantId_metaName_language: {
        tenantId,
        metaName: entry.metaTemplateName,
        language: entry.language
      }
    },
    create: {
      tenantId,
      baglantiId: baglanti.id,
      metaName: entry.metaTemplateName,
      language: entry.language,
      statusNormalized: persistedStatus,
      category: entry.category,
      libraryKey: entry.libraryKey,
      providerWabaId: wabaId,
      metaTemplateId,
      rejectionReason: null,
      componentsSnapshot: componentsSnapshotForEntry(entry) as Prisma.InputJsonValue,
      parameterFormat: entry.parameterFormat,
      submittedAt: now,
      approvedAt: persistedStatus === 'ONAYLANDI' ? now : null,
      lastSyncedAt: now
    },
    update: {
      baglantiId: baglanti.id,
      statusNormalized: persistedStatus,
      category: entry.category,
      libraryKey: entry.libraryKey,
      providerWabaId: wabaId,
      metaTemplateId,
      rejectionReason: null,
      componentsSnapshot: componentsSnapshotForEntry(entry) as Prisma.InputJsonValue,
      parameterFormat: entry.parameterFormat,
      submittedAt: now,
      approvedAt: persistedStatus === 'ONAYLANDI' ? now : undefined,
      lastSyncedAt: now
    }
  })

  const meta = getRequestMeta(req)
  await writeAuditLog({
    tenantId,
    userId,
    action: 'WHATSAPP_LIBRARY_TEMPLATE_SUBMITTED',
    entityType: 'WhatsAppMetaSablon',
    entityId: row.id,
    newValue: {
      libraryKey: entry.libraryKey,
      metaName: entry.metaTemplateName,
      statusNormalized: row.statusNormalized,
      metaTemplateId: row.metaTemplateId,
      providerWabaIdMasked: wabaId.slice(-6),
      alreadyExists
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return {
    ok: true,
    alreadyExists,
    template: serializeMetaRow(row)
  }
}

function parseCustomUsageArea(snapshot: Prisma.JsonValue | null): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const s = snapshot as Record<string, unknown>
  if (s.kind !== 'CUSTOM_TEMPLATE') return null
  return typeof s.usageArea === 'string' ? s.usageArea : null
}

function customTemplateSupportsKural(usageArea: string | null, kural: string): boolean {
  if (!usageArea) return false
  if (usageArea === 'MANUEL') return false
  if (kural === 'VADEDEN_ONCE') return usageArea === 'VADEDEN_ONCE'
  if (kural === 'VADE_GUNU') return usageArea === 'VADE_GUNU'
  if (kural === 'VADE_SONRASI') return usageArea === 'VADE_SONRASI' || usageArea === 'KISMI_ODEME_SONRASI' || usageArea === 'ODEME_ALINDI'
  return false
}

export async function listApprovedTemplatesForAutomation(
  tenantId: string,
  opts?: { requireVariables?: string[]; kuralTuru?: string; includeManual?: boolean }
): Promise<Array<Record<string, unknown>>> {
  const rows = await prisma.whatsAppMetaSablon.findMany({
    where: {
      tenantId,
      statusNormalized: 'ONAYLANDI',
      language: { in: ['tr', 'tr_TR'] }
    },
    orderBy: { lastSyncedAt: 'desc' }
  })

  return rows
    .filter((r) => {
      const customUsageArea = parseCustomUsageArea(r.componentsSnapshot)
      if (opts?.kuralTuru && !r.libraryKey) {
        if (!customTemplateSupportsKural(customUsageArea, opts.kuralTuru)) return false
      }
      if (!opts?.includeManual && customUsageArea === 'MANUEL') return false
      if (!opts?.requireVariables?.length) return true
      const entry = r.libraryKey ? getLibraryEntry(r.libraryKey) : getLibraryEntry(
        TEMPLATE_LIBRARY.find((e) => e.metaTemplateName === r.metaName)?.libraryKey ?? ''
      )
      if (!entry && !r.libraryKey) return true
      if (!entry) return false
      return opts.requireVariables.every((v) =>
        entry.variables.includes(v as keyof import('./templates.js').TemplateVars)
      )
    })
    .map((r) => ({ ...serializeMetaRow(r), usageArea: parseCustomUsageArea(r.componentsSnapshot) }))
}

export async function assignApprovedTemplateToKural(input: {
  tenantId: string
  userId: string
  kuralId: string
  metaSablonId: string | null
  req: Request
}): Promise<Record<string, unknown>> {
  const kural = await prisma.tahsilatBildirimKurali.findFirst({
    where: { id: input.kuralId, tenantId: input.tenantId }
  })
  if (!kural) throw new AppError(404, 'Kural bulunamadı.', 'NOT_FOUND')

  if (input.metaSablonId == null) {
    const updated = await prisma.tahsilatBildirimKurali.update({
      where: { id: kural.id },
      data: { metaSablonId: null, libraryKey: suggestedLibraryKeyForKural(kural.kuralTuru) }
    })
    return {
      id: updated.id,
      metaSablonId: null,
      libraryKey: updated.libraryKey,
      note: 'Otomasyonda Meta şablon seçimi kaldırıldı.'
    }
  }

  const sablon = await prisma.whatsAppMetaSablon.findFirst({
    where: { id: input.metaSablonId, tenantId: input.tenantId }
  })
  if (!sablon) {
    throw new AppError(404, 'Şablon bulunamadı.', 'TEMPLATE_NOT_FOUND')
  }
  if (sablon.statusNormalized !== 'ONAYLANDI') {
    throw new AppError(
      422,
      'Yalnızca onaylı şablonlar otomasyona atanabilir.',
      'TEMPLATE_NOT_APPROVED'
    )
  }

  const libraryKey =
    sablon.libraryKey ||
    TEMPLATE_LIBRARY.find((e) => e.metaTemplateName === sablon.metaName)?.libraryKey ||
    null

  const updated = await prisma.tahsilatBildirimKurali.update({
    where: { id: kural.id },
    data: { metaSablonId: sablon.id, libraryKey }
  })

  const meta = getRequestMeta(input.req)
  await writeAuditLog({
    tenantId: input.tenantId,
    userId: input.userId,
    action: 'WHATSAPP_KURAL_TEMPLATE_ASSIGNED',
    entityType: 'TahsilatBildirimKurali',
    entityId: updated.id,
    newValue: { metaSablonId: sablon.id, libraryKey, status: sablon.statusNormalized },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return {
    id: updated.id,
    metaSablonId: updated.metaSablonId,
    libraryKey: updated.libraryKey,
    template: serializeMetaRow(sablon)
  }
}

export type { TemplateLibraryKey }
