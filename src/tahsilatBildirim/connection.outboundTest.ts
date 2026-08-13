import type { Request } from 'express'
import { writeAdminAuditLog } from '../admin/adminAudit.service.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { env } from '../config/env.js'
import { AppError } from '../middleware/errorHandler.js'
import { loadTenantCloudCredentials } from './connection.service.js'
import { graphFetch, graphVersion } from './meta/graphClient.js'
import { isWhatsAppBaglantiConnected } from './connection.public.js'
import { prisma } from '../lib/prisma.js'

const idempotencyCache = new Map<
  string,
  { providerMessageId: string; at: number; tenantId: string }
>()

function dayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function normalizeTestPhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

/**
 * SUPER_ADMIN isteğe bağlı outbound Cloud API testi.
 * Alıcı yalnızca WHATSAPP_CLOUD_TEST_PHONE (import/worker’a bağlı değil).
 * Webhook status üretilmez. Gerçek gönderim: confirm=true + env + açık çağrı.
 */
export async function sendAdminOutboundCloudTest(
  adminId: string,
  input: { tenantId: string; confirm: boolean },
  req: Request,
  deps?: { fetchImpl?: typeof fetch; forceSend?: boolean }
): Promise<Record<string, unknown>> {
  if (!input.confirm) {
    throw new AppError(
      400,
      'Gerçek gönderim için confirm=true zorunludur.',
      'CONFIRM_REQUIRED'
    )
  }
  if (!env.WHATSAPP_CLOUD_API_ENABLED) {
    throw new AppError(503, 'WhatsApp Cloud API özelliği kapalı.', 'FEATURE_DISABLED')
  }

  const tenantId = input.tenantId.trim()
  const testPhone = env.WHATSAPP_CLOUD_TEST_PHONE?.trim()
  if (!testPhone) {
    throw new AppError(
      400,
      'İsteğe bağlı outbound-test için WHATSAPP_CLOUD_TEST_PHONE tanımlı değil. Import/worker etkilenmez.',
      'OUTBOUND_TEST_RECIPIENT_MISSING'
    )
  }
  const to = normalizeTestPhone(testPhone)
  if (to.length < 10) {
    throw new AppError(
      400,
      'WHATSAPP_CLOUD_TEST_PHONE geçersiz (yalnızca outbound-test alıcısı).',
      'OUTBOUND_TEST_RECIPIENT_INVALID'
    )
  }

  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  if (!baglanti || !isWhatsAppBaglantiConnected(baglanti.durum)) {
    throw new AppError(400, 'Tenant WhatsApp bağlantısı aktif değil.', 'WHATSAPP_NOT_CONNECTED')
  }
  if (baglanti.webhookOverrideActive) {
    // Import bağlantısı değilse de test edilebilir; uyarı flag’i
  }

  const cacheKey = `${adminId}:${tenantId}:${to}:${dayKey()}`
  const cached = idempotencyCache.get(cacheKey)
  if (cached?.providerMessageId) {
    return {
      ok: true,
      idempotent: true,
      providerMessageId: cached.providerMessageId,
      durum: 'GONDERILDI',
      note: 'Aynı gün için önceki başarılı test yanıtı (idempotent). TESLIM/OKUNDU üretilmedi.'
    }
  }

  const creds = await loadTenantCloudCredentials(tenantId)
  if (!creds.ok) {
    throw new AppError(400, creds.message, creds.code)
  }

  const templateName =
    env.WHATSAPP_CLOUD_TEST_TEMPLATE_NAME?.trim() || 'hello_world'
  const templateLang = env.WHATSAPP_CLOUD_TEST_TEMPLATE_LANG?.trim() || 'en_US'

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLang }
    }
  }

  const result = await graphFetch<{ messages?: Array<{ id?: string }> }>(
    `${encodeURIComponent(creds.phoneNumberId)}/messages`,
    {
      method: 'POST',
      accessToken: creds.accessToken,
      body,
      version: graphVersion(),
      fetchImpl: deps?.fetchImpl
    }
  )

  if (!result.ok) {
    const meta = getRequestMeta(req)
    await writeAdminAuditLog({
      adminId,
      action: 'WHATSAPP_OUTBOUND_TEST_FAILED',
      entityType: 'WhatsAppBaglanti',
      entityId: baglanti.id,
      newValue: {
        tenantId,
        httpStatus: result.httpStatus,
        errorCode: result.errorCode
        // token / phone plaintext yok
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(502, 'Meta Cloud API gönderimi başarısız.', 'META_SEND_FAILED')
  }

  const providerMessageId = result.data?.messages?.[0]?.id?.trim() || null
  if (!providerMessageId) {
    throw new AppError(502, 'Meta API message id dönmedi; gönderildi sayılmaz.', 'NO_MESSAGE_ID')
  }

  idempotencyCache.set(cacheKey, {
    providerMessageId,
    at: Date.now(),
    tenantId
  })

  const meta = getRequestMeta(req)
  await writeAdminAuditLog({
    adminId,
    action: 'WHATSAPP_OUTBOUND_TEST_SENT',
    entityType: 'WhatsAppBaglanti',
    entityId: baglanti.id,
    newValue: {
      tenantId,
      providerMessageId,
      durum: 'GONDERILDI',
      webhookOverrideActive: baglanti.webhookOverrideActive,
      note: 'TESLIM_EDILDI/OKUNDU webhook olmadan üretilmedi'
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return {
    ok: true,
    idempotent: false,
    providerMessageId,
    durum: 'GONDERILDI',
    webhookStatusExpected: false,
    note:
      'Meta send API kabul etti (GONDERILDI). Paylaşılan WABA webhook override yapılmadığı için TESLIM/OKUNDU MK’ya gelmeyebilir.'
  }
}

/** Testler için idempotency cache temizliği. */
export function clearOutboundTestIdempotencyCache(): void {
  idempotencyCache.clear()
}
