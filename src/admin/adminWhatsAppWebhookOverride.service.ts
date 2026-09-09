import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import { env } from '../config/env.js'
import { AppError } from '../middleware/errorHandler.js'
import { prisma } from '../lib/prisma.js'
import { isWhatsAppBaglantiConnected, maskMetaId } from '../tahsilatBildirim/connection.public.js'
import { loadTenantCloudCredentials } from '../tahsilatBildirim/connection.service.js'
import {
  applyWabaWebhookOverride,
  buildWebhookOverrideFailureDetails,
  clearWabaWebhookOverride,
  extractOverrideCallbackUri,
  getSubscribedApps
} from '../tahsilatBildirim/meta/wabaWebhookOverride.js'
import { writeAdminAuditLog } from './adminAudit.service.js'

export type WebhookOverrideUiDurum = 'PASIF' | 'MK_YA_YONLENDIRILIYOR'

function mkCallbackUrl(): string {
  const url = env.WHATSAPP_WEBHOOK_PUBLIC_URL?.trim() || ''
  if (!url) {
    throw new AppError(
      503,
      'WHATSAPP_WEBHOOK_PUBLIC_URL tanımlı değil.',
      'WEBHOOK_OVERRIDE_CONFIG_MISSING'
    )
  }
  return url
}

function urlsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '')
}

async function requireConnectedBaglanti(tenantId: string) {
  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  if (!baglanti || !isWhatsAppBaglantiConnected(baglanti.durum)) {
    throw new AppError(400, 'Tenant WhatsApp bağlantısı aktif değil.', 'WHATSAPP_NOT_CONNECTED')
  }
  if (!baglanti.wabaId) {
    throw new AppError(400, 'Tenant WABA ID kayıtlı değil.', 'WABA_MISSING')
  }
  return baglanti
}

/**
 * Teşhis: Graph GET + DB bayrakları. WABA/callback body’den alınmaz.
 */
export async function getAdminWhatsAppWebhookOverrideStatus(
  tenantId: string,
  deps?: { fetchImpl?: typeof fetch }
): Promise<Record<string, unknown>> {
  const baglanti = await requireConnectedBaglanti(tenantId)
  const mkUrl = env.WHATSAPP_WEBHOOK_PUBLIC_URL?.trim() || null
  const creds = await loadTenantCloudCredentials(tenantId)
  if (!creds.ok) {
    throw new AppError(400, creds.message, creds.code)
  }

  const sub = await getSubscribedApps(baglanti.wabaId!, creds.accessToken, deps?.fetchImpl)
  if (!sub.ok) {
    throw new AppError(502, 'Meta subscribed_apps okunamadı.', 'META_SUBSCRIBED_APPS_FAILED')
  }

  const liveOverride = extractOverrideCallbackUri(sub.data)
  const pointsToMk = Boolean(mkUrl && urlsEqual(liveOverride, mkUrl))
  const uiDurum: WebhookOverrideUiDurum = pointsToMk ? 'MK_YA_YONLENDIRILIYOR' : 'PASIF'

  return {
    ok: true,
    tenantId,
    uiDurum,
    uiLabel: pointsToMk ? "MK'YA YÖNLENDİRİLİYOR" : 'PASİF',
    wabaIdMasked: maskMetaId(baglanti.wabaId),
    phoneNumberIdMasked: maskMetaId(baglanti.phoneNumberId),
    displayPhoneNumber: baglanti.displayPhoneNumber,
    mkCallbackUrlConfigured: Boolean(mkUrl),
    mkCallbackHostPath: mkUrl
      ? (() => {
          try {
            const u = new URL(mkUrl)
            return `${u.origin}${u.pathname}`
          } catch {
            return null
          }
        })()
      : null,
    liveOverridePresent: Boolean(liveOverride),
    liveOverridePointsToMk: pointsToMk,
    // Tam URL yalnızca MK hedefi ise (teşhis); aksi halde host sızdırma yok
    liveOverrideHostPath:
      liveOverride && !pointsToMk
        ? (() => {
            try {
              const u = new URL(liveOverride)
              return `${u.origin}${u.pathname}`
            } catch {
              return '(invalid)'
            }
          })()
        : pointsToMk
          ? mkUrl
            ? (() => {
                try {
                  const u = new URL(mkUrl)
                  return `${u.origin}${u.pathname}`
                } catch {
                  return null
                }
              })()
            : null
          : null,
    dbWebhookOverrideActive: baglanti.webhookOverrideActive,
    dbHasOverrideCallback: Boolean(baglanti.webhookOverrideCallback),
    lastWebhookAt: baglanti.lastWebhookAt?.toISOString() ?? null
  }
}

/** Yalnızca tenant kayıtlı WABA + env MK URL/token. */
export async function enableAdminWhatsAppWebhookOverride(
  adminId: string,
  tenantId: string,
  req: Request,
  deps?: { fetchImpl?: typeof fetch }
): Promise<Record<string, unknown>> {
  const baglanti = await requireConnectedBaglanti(tenantId)
  const callbackUri = mkCallbackUrl()
  if (!env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim()) {
    throw new AppError(
      503,
      'WHATSAPP_WEBHOOK_VERIFY_TOKEN tanımlı değil.',
      'WEBHOOK_OVERRIDE_CONFIG_MISSING'
    )
  }

  const creds = await loadTenantCloudCredentials(tenantId)
  if (!creds.ok) {
    throw new AppError(400, creds.message, creds.code)
  }

  const result = await applyWabaWebhookOverride({
    wabaId: baglanti.wabaId!,
    accessToken: creds.accessToken,
    callbackUri,
    verifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    fetchImpl: deps?.fetchImpl
  })

  if (!result.ok || !result.overrideVerified) {
    const details = buildWebhookOverrideFailureDetails(result)
    // eslint-disable-next-line no-console
    console.error('[whatsapp.webhookOverride.enable] WEBHOOK_OVERRIDE_APPLY_FAILED', details)
    throw new AppError(
      502,
      'WABA webhook override MK’ya uygulanamadı veya doğrulanamadı.',
      'WEBHOOK_OVERRIDE_APPLY_FAILED',
      details
    )
  }

  const verify = await getSubscribedApps(baglanti.wabaId!, creds.accessToken, deps?.fetchImpl)
  const live = extractOverrideCallbackUri(verify.data)
  if (!urlsEqual(live, callbackUri)) {
    throw new AppError(
      502,
      'Override sonrası Graph GET MK callback’ini doğrulayamadı.',
      'WEBHOOK_OVERRIDE_VERIFY_FAILED'
    )
  }

  await prisma.whatsAppBaglanti.update({
    where: { id: baglanti.id },
    data: {
      webhookOverrideActive: true,
      webhookOverrideCallback: callbackUri,
      sonHataOzeti: null
    }
  })

  const meta = getRequestMeta(req)
  await writeAdminAuditLog({
    adminId,
    action: 'WHATSAPP_WABA_WEBHOOK_OVERRIDE_ENABLED',
    entityType: 'WhatsAppBaglanti',
    entityId: baglanti.id,
    newValue: {
      tenantId,
      wabaIdMasked: maskMetaId(baglanti.wabaId),
      overridePointsToMk: true
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getAdminWhatsAppWebhookOverrideStatus(tenantId, deps)
}

/**
 * Meta: boş POST subscribed_apps → alternate callback kalkar; App global callback’e düşer.
 * App Dashboard callback’i değiştirilmez / subscribed_apps DELETE edilmez.
 */
export async function disableAdminWhatsAppWebhookOverride(
  adminId: string,
  tenantId: string,
  req: Request,
  deps?: { fetchImpl?: typeof fetch }
): Promise<Record<string, unknown>> {
  const baglanti = await requireConnectedBaglanti(tenantId)
  const creds = await loadTenantCloudCredentials(tenantId)
  if (!creds.ok) {
    throw new AppError(400, creds.message, creds.code)
  }

  const result = await clearWabaWebhookOverride({
    wabaId: baglanti.wabaId!,
    accessToken: creds.accessToken,
    fetchImpl: deps?.fetchImpl
  })

  if (!result.ok || !result.overrideVerified) {
    throw new AppError(
      502,
      'WABA webhook override kaldırılamadı veya doğrulanamadı.',
      'WEBHOOK_OVERRIDE_CLEAR_FAILED'
    )
  }

  const verify = await getSubscribedApps(baglanti.wabaId!, creds.accessToken, deps?.fetchImpl)
  const live = extractOverrideCallbackUri(verify.data)
  if (live != null) {
    throw new AppError(
      502,
      'Kaldırma sonrası Graph GET hâlâ override_callback_uri görüyor.',
      'WEBHOOK_OVERRIDE_CLEAR_VERIFY_FAILED'
    )
  }

  await prisma.whatsAppBaglanti.update({
    where: { id: baglanti.id },
    data: {
      webhookOverrideActive: false,
      webhookOverrideCallback: null,
      sonHataOzeti: null
    }
  })

  const meta = getRequestMeta(req)
  await writeAdminAuditLog({
    adminId,
    action: 'WHATSAPP_WABA_WEBHOOK_OVERRIDE_DISABLED',
    entityType: 'WhatsAppBaglanti',
    entityId: baglanti.id,
    newValue: {
      tenantId,
      wabaIdMasked: maskMetaId(baglanti.wabaId),
      overrideCleared: true
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return getAdminWhatsAppWebhookOverrideStatus(tenantId, deps)
}
