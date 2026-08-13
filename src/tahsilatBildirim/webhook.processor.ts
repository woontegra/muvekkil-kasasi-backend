import { BildirimIsDurumu, WhatsAppBaglantiDurumu } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { maskPhone } from './phone.js'
import { isWhatsAppBaglantiConnected } from './connection.public.js'

/** OKUNDU > TESLIM_EDILDI > GONDERILDI > others; never regress. */
export function bildirimStatusRank(durum: BildirimIsDurumu | string): number {
  switch (durum) {
    case BildirimIsDurumu.OKUNDU:
    case 'OKUNDU':
      return 40
    case BildirimIsDurumu.TESLIM_EDILDI:
    case 'TESLIM_EDILDI':
      return 30
    case BildirimIsDurumu.GONDERILDI:
    case 'GONDERILDI':
      return 20
    case BildirimIsDurumu.BASARISIZ:
    case 'BASARISIZ':
      return 10
    default:
      return 0
  }
}

export function canAdvanceBildirimStatus(
  current: BildirimIsDurumu | string,
  next: BildirimIsDurumu | string
): boolean {
  return bildirimStatusRank(next) > bildirimStatusRank(current)
}

export function mapMetaStatusToBildirim(statusRaw: string): BildirimIsDurumu | null {
  switch (statusRaw.trim().toLowerCase()) {
    case 'sent':
      return BildirimIsDurumu.GONDERILDI
    case 'delivered':
      return BildirimIsDurumu.TESLIM_EDILDI
    case 'read':
      return BildirimIsDurumu.OKUNDU
    case 'failed':
      return BildirimIsDurumu.BASARISIZ
    default:
      return null
  }
}

type MetaStatus = {
  id?: string
  status?: string
  timestamp?: string
  errors?: Array<{ code?: number; title?: string }>
}

type MetaMessage = {
  id?: string
  from?: string
  timestamp?: string
  type?: string
}

type MetaChangeValue = {
  messaging_product?: string
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  statuses?: MetaStatus[]
  messages?: MetaMessage[]
}

type MetaEntry = {
  id?: string
  changes?: Array<{ field?: string; value?: MetaChangeValue }>
}

export type MetaWebhookPayload = {
  object?: string
  entry?: MetaEntry[]
}

export type ProcessWebhookResult = {
  accepted: boolean
  processed: number
  skipped: number
  errors: number
}

function makeMetaEventId(parts: Array<string | undefined | null>): string {
  return parts.filter(Boolean).join('|').slice(0, 240)
}

/**
 * Webhook POST işleyici.
 * phone_number_id → baglanti (BAGLI/ACTIVE) routing.
 * Status idempotent + rank; inbound yalnızca metadata.
 */
export async function processWhatsAppWebhookPayload(
  payload: MetaWebhookPayload
): Promise<ProcessWebhookResult> {
  const result: ProcessWebhookResult = {
    accepted: true,
    processed: 0,
    skipped: 0,
    errors: 0
  }

  if (payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    result.accepted = true
    result.skipped += 1
    return result
  }

  for (const entry of payload.entry) {
    const wabaId = entry.id?.trim() || null
    for (const change of entry.changes ?? []) {
      const value = change.value
      if (!value) continue
      const phoneNumberId = value.metadata?.phone_number_id?.trim() || null

      const baglanti = phoneNumberId
        ? await prisma.whatsAppBaglanti.findFirst({
            where: {
              phoneNumberId,
              durum: { in: [WhatsAppBaglantiDurumu.BAGLI, WhatsAppBaglantiDurumu.ACTIVE] }
            }
          })
        : null

      if (phoneNumberId && baglanti) {
        await prisma.whatsAppBaglanti.update({
          where: { id: baglanti.id },
          data: { lastWebhookAt: new Date() }
        })
      }

      // Status updates
      for (const st of value.statuses ?? []) {
        const providerMessageId = st.id?.trim() || null
        const statusRaw = st.status?.trim() || ''
        const metaEventId = makeMetaEventId([
          'status',
          providerMessageId,
          statusRaw,
          st.timestamp
        ])

        const existing = await prisma.whatsAppWebhookEvent.findUnique({
          where: { metaEventId }
        })
        if (existing) {
          result.skipped += 1
          continue
        }

        if (!baglanti || !isWhatsAppBaglantiConnected(baglanti.durum)) {
          await prisma.whatsAppWebhookEvent.create({
            data: {
              metaEventId,
              phoneNumberId,
              wabaId,
              eventType: 'status',
              statusRaw,
              providerMessageId,
              processedOk: false,
              errorCode: 'NO_ROUTE'
            }
          })
          result.skipped += 1
          continue
        }

        const nextDurum = mapMetaStatusToBildirim(statusRaw)
        let processedOk = false
        let errorCode: string | null = null

        try {
          if (providerMessageId && nextDurum) {
            const job = await prisma.tahsilatBildirimIsi.findFirst({
              where: { providerMessageId, tenantId: baglanti.tenantId }
            })
            if (job && canAdvanceBildirimStatus(job.durum, nextDurum)) {
              await prisma.tahsilatBildirimIsi.update({
                where: { id: job.id },
                data: {
                  durum: nextDurum,
                  ...(nextDurum === BildirimIsDurumu.BASARISIZ
                    ? {
                        hataOzeti: (st.errors?.[0]?.title || 'Meta failed').slice(0, 400),
                        sonProviderHataKodu:
                          st.errors?.[0]?.code != null
                            ? `META_${st.errors[0].code}`
                            : 'META_FAILED'
                      }
                    : {})
                }
              })
              processedOk = true
            } else if (job) {
              processedOk = true
              errorCode = 'STATUS_NO_REGRESS'
            } else {
              errorCode = 'JOB_NOT_FOUND'
            }
          } else {
            errorCode = 'UNKNOWN_STATUS'
          }

          await prisma.whatsAppWebhookEvent.create({
            data: {
              tenantId: baglanti.tenantId,
              baglantiId: baglanti.id,
              metaEventId,
              phoneNumberId,
              wabaId,
              eventType: 'status',
              statusRaw,
              providerMessageId,
              processedOk,
              errorCode
            }
          })
          if (processedOk) result.processed += 1
          else result.skipped += 1
        } catch {
          result.errors += 1
          try {
            await prisma.whatsAppWebhookEvent.create({
              data: {
                tenantId: baglanti.tenantId,
                baglantiId: baglanti.id,
                metaEventId,
                phoneNumberId,
                wabaId,
                eventType: 'status',
                statusRaw,
                providerMessageId,
                processedOk: false,
                errorCode: 'PROCESS_ERROR'
              }
            })
          } catch {
            // unique race
          }
        }
      }

      // Inbound messages — metadata only
      for (const msg of value.messages ?? []) {
        const metaMessageId = msg.id?.trim()
        if (!metaMessageId) {
          result.skipped += 1
          continue
        }

        const metaEventId = makeMetaEventId(['inbound', metaMessageId])
        const existing = await prisma.whatsAppWebhookEvent.findUnique({
          where: { metaEventId }
        })
        if (existing) {
          result.skipped += 1
          continue
        }

        if (!baglanti || !isWhatsAppBaglantiConnected(baglanti.durum)) {
          await prisma.whatsAppWebhookEvent.create({
            data: {
              metaEventId,
              phoneNumberId,
              wabaId,
              eventType: 'inbound',
              providerMessageId: metaMessageId,
              processedOk: false,
              errorCode: 'NO_ROUTE'
            }
          })
          result.skipped += 1
          continue
        }

        const receivedAt = msg.timestamp
          ? new Date(Number(msg.timestamp) * 1000)
          : new Date()
        const senderMasked = msg.from ? maskPhone(msg.from) : '••••'

        try {
          await prisma.whatsAppGelenMesaj.upsert({
            where: { metaMessageId },
            create: {
              tenantId: baglanti.tenantId,
              baglantiId: baglanti.id,
              metaMessageId,
              messageType: (msg.type || 'unknown').slice(0, 64),
              senderMasked,
              receivedAt,
              processedDurum: 'ALINDI'
            },
            update: {}
          })

          await prisma.whatsAppWebhookEvent.create({
            data: {
              tenantId: baglanti.tenantId,
              baglantiId: baglanti.id,
              metaEventId,
              phoneNumberId,
              wabaId,
              eventType: 'inbound',
              providerMessageId: metaMessageId,
              processedOk: true
            }
          })
          result.processed += 1
        } catch {
          result.errors += 1
        }
      }
    }
  }

  return result
}
