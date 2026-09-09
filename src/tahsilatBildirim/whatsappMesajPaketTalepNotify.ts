/**
 * Yeni WhatsApp mesaj paketi talebi → Platform Admin bildirimleri (e-posta + WhatsApp).
 * Talep oluşturmayı asla bozmaz (fire-and-forget + hata yutulur / audit).
 * WhatsApp: tenant mesaj kredisi düşmez (consumeForJob yok).
 */
import { writeAdminAuditLog } from '../admin/adminAudit.service.js'
import { prisma } from '../lib/prisma.js'
import {
  sendAdminWhatsAppPaketTalepEmail,
  type AdminWhatsAppPaketTalepMailResult
} from '../mail/mail.service.js'
import { getWhatsAppMesajPaketiById } from './whatsappMesajPaketleri.js'
import {
  sendAdminWhatsAppPaketTalepWhatsApp,
  type AdminWhatsAppPaketTalepWaResult
} from './whatsappMesajPaketTalepAdminWa.js'

export type AdminPaketTalepNotifyInput = {
  id: string
  tenantId: string
  packageId: string
  mesajAdedi: number
  fiyatTL: number
  paymentReference: string
  createdAt: string
}

/** @deprecated Eski isim — AdminPaketTalepNotifyInput kullanın. */
export type AdminPaketTalepMailNotifyInput = AdminPaketTalepNotifyInput

export type AdminPaketTalepMailSender = (params: {
  buroAdi: string
  tenantId: string
  packageId: string
  paketLabel: string
  mesajAdedi: number
  fiyatTL: number
  paymentReference: string
  talepCreatedAt: string
}) => Promise<AdminWhatsAppPaketTalepMailResult>

export type AdminPaketTalepWaSender = (params: {
  buroAdi: string
  requestingTenantId: string
  packageId: string
  paketLabel: string
  mesajAdedi: number
  fiyatTL: number
}) => Promise<AdminWhatsAppPaketTalepWaResult>

let mailSender: AdminPaketTalepMailSender = (params) => sendAdminWhatsAppPaketTalepEmail(params)
let waSender: AdminPaketTalepWaSender = (params) => sendAdminWhatsAppPaketTalepWhatsApp(params)
const pendingJobs: Promise<void>[] = []

export function setAdminWhatsAppPaketTalepMailSenderForTests(
  fn: AdminPaketTalepMailSender | null
): void {
  mailSender = fn ?? ((params) => sendAdminWhatsAppPaketTalepEmail(params))
}

export function setAdminWhatsAppPaketTalepWaSenderForTests(
  fn: AdminPaketTalepWaSender | null
): void {
  waSender = fn ?? ((params) => sendAdminWhatsAppPaketTalepWhatsApp(params))
}

export async function flushAdminWhatsAppPaketTalepMailsForTests(): Promise<void> {
  await Promise.all([...pendingJobs])
}

export const flushAdminWhatsAppPaketTalepNotificationsForTests =
  flushAdminWhatsAppPaketTalepMailsForTests

function track(job: Promise<void>): void {
  pendingJobs.push(job)
  void job.finally(() => {
    const i = pendingJobs.indexOf(job)
    if (i >= 0) pendingJobs.splice(i, 1)
  })
}

async function resolveBuroAndPaket(talep: AdminPaketTalepNotifyInput): Promise<{
  buroAdi: string
  paketLabel: string
}> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: talep.tenantId },
    select: { buroAdi: true }
  })
  const paket = getWhatsAppMesajPaketiById(talep.packageId)
  return {
    buroAdi: tenant?.buroAdi?.trim() || 'Bilinmeyen büro',
    paketLabel: paket?.label ?? `${talep.mesajAdedi.toLocaleString('tr-TR')} mesaj`
  }
}

async function deliverMail(talep: AdminPaketTalepNotifyInput): Promise<void> {
  const { buroAdi, paketLabel } = await resolveBuroAndPaket(talep)
  const result = await mailSender({
    buroAdi,
    tenantId: talep.tenantId,
    packageId: talep.packageId,
    paketLabel,
    mesajAdedi: talep.mesajAdedi,
    fiyatTL: talep.fiyatTL,
    paymentReference: talep.paymentReference,
    talepCreatedAt: talep.createdAt
  })
  if (result.sent) return
  try {
    await writeAdminAuditLog({
      adminId: null,
      action: 'WHATSAPP_PAKET_TALEP_ADMIN_MAIL_FAILED',
      entityType: 'WhatsAppMesajPaketTalebi',
      entityId: talep.id,
      newValue: {
        tenantId: talep.tenantId,
        packageId: talep.packageId,
        mesajAdedi: talep.mesajAdedi,
        fiyatTL: talep.fiyatTL,
        skipped: Boolean(result.skipped),
        error: result.error ?? 'unknown',
        toMasked: result.toMasked ?? null,
        subject: result.subject ?? null
      }
    })
  } catch (auditErr) {
    // eslint-disable-next-line no-console
    console.error('[wa-paket-talep-mail] audit log failed', auditErr)
  }
}

async function deliverWhatsApp(talep: AdminPaketTalepNotifyInput): Promise<void> {
  const { buroAdi, paketLabel } = await resolveBuroAndPaket(talep)
  const result = await waSender({
    buroAdi,
    requestingTenantId: talep.tenantId,
    packageId: talep.packageId,
    paketLabel,
    mesajAdedi: talep.mesajAdedi,
    fiyatTL: talep.fiyatTL
  })
  if (result.sent) return
  try {
    await writeAdminAuditLog({
      adminId: null,
      action: 'WHATSAPP_PAKET_TALEP_ADMIN_WA_FAILED',
      entityType: 'WhatsAppMesajPaketTalebi',
      entityId: talep.id,
      newValue: {
        tenantId: talep.tenantId,
        packageId: talep.packageId,
        mesajAdedi: talep.mesajAdedi,
        fiyatTL: talep.fiyatTL,
        attempted: result.attempted,
        skipped: Boolean(result.skipped),
        error: result.error ?? 'unknown',
        code: result.code ?? null,
        toMasked: result.toMasked ?? null,
        senderTenantId: result.senderTenantId ?? null,
        templateName: result.templateName ?? null
      }
    })
  } catch (auditErr) {
    // eslint-disable-next-line no-console
    console.error('[wa-paket-talep-wa] audit log failed', auditErr)
  }
}

function scheduleMail(talep: AdminPaketTalepNotifyInput): void {
  const job = deliverMail(talep).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[wa-paket-talep-mail] unexpected failure', err)
    void writeAdminAuditLog({
      adminId: null,
      action: 'WHATSAPP_PAKET_TALEP_ADMIN_MAIL_FAILED',
      entityType: 'WhatsAppMesajPaketTalebi',
      entityId: talep.id,
      newValue: {
        tenantId: talep.tenantId,
        packageId: talep.packageId,
        error: err instanceof Error ? err.message : String(err)
      }
    }).catch(() => undefined)
  })
  track(job)
}

function scheduleWhatsApp(talep: AdminPaketTalepNotifyInput): void {
  const job = deliverWhatsApp(talep).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[wa-paket-talep-wa] unexpected failure', err)
    void writeAdminAuditLog({
      adminId: null,
      action: 'WHATSAPP_PAKET_TALEP_ADMIN_WA_FAILED',
      entityType: 'WhatsAppMesajPaketTalebi',
      entityId: talep.id,
      newValue: {
        tenantId: talep.tenantId,
        packageId: talep.packageId,
        error: err instanceof Error ? err.message : String(err)
      }
    }).catch(() => undefined)
  })
  track(job)
}

/**
 * Yalnız yeni talep kaydı sonrası (alreadyExists=false).
 * E-posta + WhatsApp best-effort; biri veya ikisi fail olsa talep korunur.
 */
export function scheduleAdminWhatsAppPaketTalepCreatedNotifications(
  talep: AdminPaketTalepNotifyInput
): void {
  scheduleMail(talep)
  scheduleWhatsApp(talep)
}

/** @deprecated scheduleAdminWhatsAppPaketTalepCreatedNotifications kullanın. */
export function scheduleAdminWhatsAppPaketTalepCreatedMail(
  talep: AdminPaketTalepNotifyInput
): void {
  scheduleAdminWhatsAppPaketTalepCreatedNotifications(talep)
}
