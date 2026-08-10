import { Prisma } from '@prisma/client'
import type { LicenseExpiryReminderType } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { findTenantOwner } from '../tenant/provisionTenantWithOwner.js'
import { getMkLicenseRenewalEntryUrl } from '../mail/mail.config.js'
import { sendLicenseExpiryReminderEmail } from '../mail/mail.service.js'
import {
  calendarDaysUntilLicenseEnd,
  daysForReminderType,
  isEligibleForLicenseExpiryReminder,
  licenseEndDateKey,
  resolveDueReminderType
} from './licenseExpiryReminder.time.js'

const MAX_SEND_ATTEMPTS = 3

export type ProcessLicenseExpiryRemindersOptions = {
  /** false ise mail gönderilmez; yalnızca log/plan. Production cron için true + env ile açılır. */
  sendEnabled?: boolean
  now?: Date
}

export type ProcessLicenseExpiryRemindersResult = {
  scanned: number
  due: number
  sent: number
  skipped: number
  failed: number
  dryRun: number
}

function resolveOwnerEmail(ownerEposta: string | null | undefined, tenantEposta: string | null | undefined): string | null {
  const email = ownerEposta?.trim().toLowerCase() || tenantEposta?.trim().toLowerCase() || null
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

async function loadSentReminderTypes(tenantId: string, licenseEndDate: Date): Promise<Set<LicenseExpiryReminderType>> {
  const rows = await prisma.licenseExpiryReminder.findMany({
    where: { tenantId, licenseEndDate, status: 'SENT' },
    select: { reminderType: true }
  })
  return new Set(rows.map((r) => r.reminderType))
}

async function ensureReminderRow(input: {
  tenantId: string
  licenseEndDate: Date
  reminderType: LicenseExpiryReminderType
  recipient: string
}): Promise<{ id: string; status: string; attemptCount: number } | null> {
  try {
    const row = await prisma.licenseExpiryReminder.create({
      data: {
        tenantId: input.tenantId,
        licenseEndDate: input.licenseEndDate,
        reminderType: input.reminderType,
        recipient: input.recipient,
        status: 'PENDING'
      },
      select: { id: true, status: true, attemptCount: true }
    })
    return row
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e
    const existing = await prisma.licenseExpiryReminder.findUnique({
      where: {
        tenantId_licenseEndDate_reminderType: {
          tenantId: input.tenantId,
          licenseEndDate: input.licenseEndDate,
          reminderType: input.reminderType
        }
      },
      select: { id: true, status: true, attemptCount: true }
    })
    return existing
  }
}

async function processOneReminder(input: {
  tenantId: string
  buroAdi: string
  lisansBitisTarihi: Date
  reminderType: LicenseExpiryReminderType
  ownerAdSoyad: string
  recipient: string
  sendEnabled: boolean
}): Promise<'sent' | 'skipped' | 'failed' | 'dry_run'> {
  const licenseEndDate = licenseEndDateKey(input.lisansBitisTarihi)

  const row = await ensureReminderRow({
    tenantId: input.tenantId,
    licenseEndDate,
    reminderType: input.reminderType,
    recipient: input.recipient
  })
  if (!row) return 'skipped'
  if (row.status === 'SENT') return 'skipped'
  if (row.status === 'SKIPPED') return 'skipped'
  if (row.attemptCount >= MAX_SEND_ATTEMPTS && row.status === 'FAILED') return 'skipped'

  const claimed = await prisma.licenseExpiryReminder.updateMany({
    where: {
      id: row.id,
      status: { in: ['PENDING', 'FAILED'] },
      attemptCount: { lt: MAX_SEND_ATTEMPTS }
    },
    data: { attemptCount: { increment: 1 } }
  })
  if (claimed.count !== 1) return 'skipped'

  const tenantNow = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { lisansBitisTarihi: true, demoMu: true, lisansDurumu: true, aktifMi: true }
  })
  if (
    !tenantNow?.lisansBitisTarihi ||
    licenseEndDateKey(tenantNow.lisansBitisTarihi).getTime() !== licenseEndDate.getTime() ||
    !isEligibleForLicenseExpiryReminder({
      demoMu: tenantNow.demoMu,
      aktifMi: tenantNow.aktifMi,
      lisansDurumu: tenantNow.lisansDurumu,
      lisansBitisTarihi: tenantNow.lisansBitisTarihi
    })
  ) {
    await prisma.licenseExpiryReminder.update({
      where: { id: row.id },
      data: { status: 'SKIPPED', error: 'license_end_changed_or_ineligible' }
    })
    return 'skipped'
  }

  if (!input.sendEnabled) {
    return 'dry_run'
  }

  try {
    const renewalEntryUrl = getMkLicenseRenewalEntryUrl()
    const displayDays = daysForReminderType(input.reminderType)
    const mail = await sendLicenseExpiryReminderEmail({
      to: input.recipient,
      adSoyad: input.ownerAdSoyad,
      buroAdi: input.buroAdi,
      lisansBitisTarihi: input.lisansBitisTarihi.toISOString(),
      daysRemaining: displayDays,
      renewalUrl: renewalEntryUrl
    })
    if (!mail.sent) {
      await prisma.licenseExpiryReminder.update({
        where: { id: row.id },
        data: { status: 'FAILED', error: mail.error ?? 'mail_send_failed' }
      })
      return 'failed'
    }
    await prisma.licenseExpiryReminder.update({
      where: { id: row.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        error: null
      }
    })
    return 'sent'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.licenseExpiryReminder.update({
      where: { id: row.id },
      data: { status: 'FAILED', error: msg.slice(0, 500) }
    })
    return 'failed'
  }
}

export async function processLicenseExpiryReminders(
  options: ProcessLicenseExpiryRemindersOptions = {}
): Promise<ProcessLicenseExpiryRemindersResult> {
  const now = options.now ?? new Date()
  const sendEnabled = options.sendEnabled === true
  const result: ProcessLicenseExpiryRemindersResult = {
    scanned: 0,
    due: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    dryRun: 0
  }

  const tenants = await prisma.tenant.findMany({
    where: {
      aktifMi: true,
      demoMu: false,
      lisansDurumu: 'AKTIF',
      lisansBitisTarihi: { not: null }
    },
    select: {
      id: true,
      buroAdi: true,
      eposta: true,
      lisansBitisTarihi: true,
      demoMu: true,
      aktifMi: true,
      lisansDurumu: true
    }
  })

  for (const tenant of tenants) {
    result.scanned += 1
    const end = tenant.lisansBitisTarihi
    if (!end) continue
    if (
      !isEligibleForLicenseExpiryReminder({
        demoMu: tenant.demoMu,
        aktifMi: tenant.aktifMi,
        lisansDurumu: tenant.lisansDurumu,
        lisansBitisTarihi: end
      })
    ) {
      continue
    }

    const daysRemaining = calendarDaysUntilLicenseEnd(end, now)
    const licenseEndDate = licenseEndDateKey(end)
    const alreadySent = await loadSentReminderTypes(tenant.id, licenseEndDate)
    const dueReminder = resolveDueReminderType(daysRemaining, alreadySent)
    if (!dueReminder) continue

    const { reminderType } = dueReminder
    result.due += 1

    const owner = await findTenantOwner(tenant.id)
    const recipient = resolveOwnerEmail(owner?.eposta, tenant.eposta)
    if (!owner || !recipient) {
      await prisma.licenseExpiryReminder.upsert({
        where: {
          tenantId_licenseEndDate_reminderType: {
            tenantId: tenant.id,
            licenseEndDate,
            reminderType
          }
        },
        create: {
          tenantId: tenant.id,
          licenseEndDate,
          reminderType,
          recipient: recipient ?? '—',
          status: 'SKIPPED',
          error: 'no_owner_or_email'
        },
        update: {
          status: 'SKIPPED',
          error: 'no_owner_or_email'
        }
      })
      result.skipped += 1
      continue
    }

    const outcome = await processOneReminder({
      tenantId: tenant.id,
      buroAdi: tenant.buroAdi,
      lisansBitisTarihi: end,
      reminderType,
      ownerAdSoyad: owner.adSoyad,
      recipient,
      sendEnabled
    })

    if (outcome === 'sent') result.sent += 1
    else if (outcome === 'failed') result.failed += 1
    else if (outcome === 'dry_run') result.dryRun += 1
    else result.skipped += 1
  }

  return result
}

export { daysForReminderType, resolveDueReminderType }
