import crypto from 'node:crypto'
import type { Request } from 'express'
import { prisma } from '../../lib/prisma.js'
import { writeAuditLog } from '../../audit/auditService.js'
import { hashPassword } from '../../admin/adminAuth.service.js'
import { issueActivationToken } from '../../auth/passwordReset.service.js'
import { getRequestMeta } from '../../auth/requestMeta.js'
import { getActivationTokenExpiresHours } from '../../config/env.js'
import { AppError } from '../../middleware/errorHandler.js'
import { isValidKullaniciAdi, normalizeKullaniciAdi } from '../../lib/normalizeKullaniciAdi.js'
import { sendWelcomeActivationEmail } from '../../mail/mail.service.js'
import {
  findTenantOwner,
  provisionTenantWithOwner
} from '../../tenant/provisionTenantWithOwner.js'
import type { WoontegraWebsiteProvisionBody } from './woontegraWebsiteProvision.schemas.js'

const DEFAULT_LICENSE_NOTE = 'Woontegra Website ödeme sonrası otomatik oluşturuldu.'

export type WoontegraWebsiteProvisionCreatedResponse = {
  ok: true
  status: 'created'
  tenantId: string
  tenantSlug: string
  ownerUserId: string
  ownerEmail: string
  licenseStartDate: string
  licenseEndDate: string
  licenseKey: string | null
  mailSent: boolean
  mailError?: string
}

export type WoontegraWebsiteProvisionExistsResponse = {
  ok: true
  status: 'already_exists'
  tenantId: string
  tenantSlug: string
  ownerEmail: string
  licenseStartDate: string
  licenseEndDate: string
  licenseKey: string | null
}

export type WoontegraWebsiteProvisionResponse =
  | WoontegraWebsiteProvisionCreatedResponse
  | WoontegraWebsiteProvisionExistsResponse

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime())
  d.setDate(d.getDate() + days)
  return d
}

function resolveBuroAdi(body: WoontegraWebsiteProvisionBody): string {
  const office = body.tenant?.officeName?.trim() || body.tenant?.name?.trim()
  if (office) return office
  return body.customer.name.trim()
}

function resolveOwnerUsername(body: WoontegraWebsiteProvisionBody): string {
  const emailLocal = body.customer.email.split('@')[0] ?? ''
  const fromEmail = normalizeKullaniciAdi(emailLocal)
  if (isValidKullaniciAdi(fromEmail)) return fromEmail
  const fromName = normalizeKullaniciAdi(body.customer.name)
  if (isValidKullaniciAdi(fromName)) return fromName
  throw new AppError(422, 'Geçerli owner kullanıcı adı üretilemedi.', 'VALIDATION_ERROR')
}

function resolveLicenseWindow(body: WoontegraWebsiteProvisionBody): {
  start: Date
  end: Date
  isDemo: boolean
} {
  const start = body.licenseStartDate ?? new Date()
  const end = body.licenseEndDate ?? addDays(start, body.licenseDays)
  const isDemo = body.demoMu === true || body.licenseStatus === 'DEMO'
  return { start, end, isDemo }
}

function buildLicenseNotes(body: WoontegraWebsiteProvisionBody): string {
  const extra = body.notes?.trim()
  return extra ? `${DEFAULT_LICENSE_NOTE} ${extra}` : DEFAULT_LICENSE_NOTE
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain || !local) return '***'
  const visible = local.length <= 2 ? (local[0] ?? '*') : `${local.slice(0, 2)}***`
  return `${visible}@${domain}`
}

async function sendOwnerActivationEmail(
  tenant: {
    id: string
    buroAdi: string
    lisansBaslangicTarihi: Date | null
    lisansBitisTarihi: Date | null
    lisansAnahtari: string | null
  },
  owner: { id: string; kullaniciAdi: string; eposta: string | null },
  fallback: { ownerEmail: string; licenseStart: string; licenseEnd: string },
  meta: { ipAddress: string | null; userAgent: string | null }
): Promise<{ mailSent: boolean; mailError?: string }> {
  const email = (owner.eposta?.trim() || fallback.ownerEmail).toLowerCase()
  const toMasked = maskEmail(email)

  try {
    const { plainToken } = await issueActivationToken(owner.id)
    const result = await sendWelcomeActivationEmail({
      to: email,
      plainToken,
      buroAdi: tenant.buroAdi,
      kullaniciAdi: owner.kullaniciAdi,
      lisansBaslangic: tenant.lisansBaslangicTarihi?.toISOString() ?? fallback.licenseStart,
      lisansBitis: tenant.lisansBitisTarihi?.toISOString() ?? fallback.licenseEnd,
      lisansAnahtari: tenant.lisansAnahtari,
      activationExpiresHours: getActivationTokenExpiresHours()
    })

    if (!result.sent) {
      const error = result.error ?? 'MAIL_SEND_FAILED'
      console.error('[woontegra-website] welcome activation mail not sent', {
        tenantId: tenant.id,
        recipient: toMasked,
        error
      })
      await writeAuditLog({
        tenantId: tenant.id,
        userId: owner.id,
        action: 'WELCOME_ACTIVATION_EMAIL_FAILED',
        entityType: 'User',
        entityId: owner.id,
        newValue: { error },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      })
      return { mailSent: false, mailError: error }
    }

    console.info('[woontegra-website] welcome activation mail sent', {
      tenantId: tenant.id,
      recipient: toMasked
    })
    await writeAuditLog({
      tenantId: tenant.id,
      userId: owner.id,
      action: 'WELCOME_ACTIVATION_EMAIL_SENT',
      entityType: 'User',
      entityId: owner.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    return { mailSent: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[woontegra-website] welcome activation mail failed', {
      tenantId: tenant.id,
      recipient: toMasked,
      error: msg
    })
    await writeAuditLog({
      tenantId: tenant.id,
      userId: owner.id,
      action: 'WELCOME_ACTIVATION_EMAIL_FAILED',
      entityType: 'User',
      entityId: owner.id,
      newValue: { error: msg },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    return { mailSent: false, mailError: msg }
  }
}

function toExistsResponse(
  tenant: {
    id: string
    slug: string
    lisansBaslangicTarihi: Date | null
    lisansBitisTarihi: Date | null
    lisansAnahtari: string | null
  },
  ownerEmail: string
): WoontegraWebsiteProvisionExistsResponse {
  return {
    ok: true,
    status: 'already_exists',
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    ownerEmail,
    licenseStartDate: tenant.lisansBaslangicTarihi?.toISOString() ?? '',
    licenseEndDate: tenant.lisansBitisTarihi?.toISOString() ?? '',
    licenseKey: tenant.lisansAnahtari
  }
}

export async function provisionTenantFromWoontegraWebsite(
  body: WoontegraWebsiteProvisionBody,
  req: Request
): Promise<WoontegraWebsiteProvisionResponse> {
  const meta = getRequestMeta(req)
  const idempotencyHeader = req.header('x-idempotency-key')?.trim()
  if (idempotencyHeader && idempotencyHeader !== body.externalOrderId) {
    throw new AppError(
      400,
      'x-idempotency-key, externalOrderId ile aynı olmalı.',
      'IDEMPOTENCY_KEY_MISMATCH'
    )
  }

  console.info('[woontegra-website] WOONTEGRA_WEBSITE_PROVISION_REQUEST', {
    externalOrderId: body.externalOrderId,
    productCode: body.productCode
  })

  await writeAuditLog({
    tenantId: null,
    userId: null,
    action: 'WOONTEGRA_WEBSITE_PROVISION_REQUEST',
    entityType: 'Tenant',
    newValue: {
      externalOrderId: body.externalOrderId,
      externalCustomerId: body.externalCustomerId ?? null,
      productCode: body.productCode
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  const mailFallback = {
    ownerEmail: body.customer.email.trim().toLowerCase(),
    licenseStart: '',
    licenseEnd: ''
  }

  const existing = await prisma.tenant.findUnique({
    where: { externalOrderId: body.externalOrderId }
  })

  if (existing) {
    const owner = await findTenantOwner(existing.id)
    if (!owner) {
      throw new AppError(500, 'Mevcut tenant için büro sahibi bulunamadı.', 'OWNER_MISSING')
    }
    const ownerEmail = owner.eposta?.trim().toLowerCase() || mailFallback.ownerEmail
    mailFallback.licenseStart = existing.lisansBaslangicTarihi?.toISOString() ?? ''
    mailFallback.licenseEnd = existing.lisansBitisTarihi?.toISOString() ?? ''

    await writeAuditLog({
      tenantId: existing.id,
      userId: owner.id,
      action: 'WOONTEGRA_WEBSITE_PROVISION_IDEMPOTENT_HIT',
      entityType: 'Tenant',
      entityId: existing.id,
      newValue: { externalOrderId: body.externalOrderId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })

    await sendOwnerActivationEmail(existing, owner, mailFallback, meta)
    return toExistsResponse(existing, ownerEmail)
  }

  const { start, end, isDemo } = resolveLicenseWindow(body)
  mailFallback.licenseStart = start.toISOString()
  mailFallback.licenseEnd = end.toISOString()

  const kullaniciAdi = resolveOwnerUsername(body)
  const randomSecret = crypto.randomBytes(32).toString('base64url')
  const sifreHash = await hashPassword(randomSecret)
  const now = new Date()
  const paidAt = body.billing?.paidAt ?? now

  let created: Awaited<ReturnType<typeof provisionTenantWithOwner>>

  try {
    created = await provisionTenantWithOwner(
      {
        buroAdi: resolveBuroAdi(body),
        telefon: body.tenant?.phone ?? body.customer.phone ?? null,
        eposta: body.tenant?.email ?? null,
        adres: body.tenant?.address ?? null,
        vergiNo: body.tenant?.taxNumber ?? null,
        vergiDairesi: body.tenant?.taxOffice ?? null,
        aktifMi: true,
        lisansBaslangicTarihi: start,
        lisansBitisTarihi: end,
        lisansDurumu: isDemo ? 'DEMO' : 'AKTIF',
        demoMu: isDemo,
        demoBitisTarihi: isDemo ? end : null,
        yillikUcret: body.billing?.amount ?? null,
        sonOdemeTarihi: paidAt,
        lisansNotlari: buildLicenseNotes(body),
        externalOrderId: body.externalOrderId,
        externalCustomerId: body.externalCustomerId ?? null,
        owner: {
          adSoyad: body.customer.name.trim(),
          kullaniciAdi,
          eposta: body.customer.email.trim().toLowerCase(),
          telefon: body.customer.phone ?? null,
          sifreHash
        }
      },
      {
        source: 'WOONTEGRA_WEBSITE',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      }
    )
  } catch (e) {
    if (e instanceof AppError && e.code === 'DUPLICATE') {
      const raced = await prisma.tenant.findUnique({
        where: { externalOrderId: body.externalOrderId }
      })
      if (raced) {
        const owner = await findTenantOwner(raced.id)
        if (owner) {
          const ownerEmail = owner.eposta?.trim().toLowerCase() || mailFallback.ownerEmail
          await writeAuditLog({
            tenantId: raced.id,
            userId: owner.id,
            action: 'WOONTEGRA_WEBSITE_PROVISION_IDEMPOTENT_HIT',
            entityType: 'Tenant',
            entityId: raced.id,
            newValue: { externalOrderId: body.externalOrderId, race: true },
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent
          })
          await sendOwnerActivationEmail(raced, owner, mailFallback, meta)
          return toExistsResponse(raced, ownerEmail)
        }
      }
    }
    throw e
  }

  const mail = await sendOwnerActivationEmail(created.tenant, created.ownerUser, mailFallback, meta)
  const ownerEmail = created.ownerUser.eposta?.trim().toLowerCase() || mailFallback.ownerEmail

  return {
    ok: true,
    status: 'created',
    tenantId: created.tenant.id,
    tenantSlug: created.tenant.slug,
    ownerUserId: created.ownerUser.id,
    ownerEmail,
    licenseStartDate: created.tenant.lisansBaslangicTarihi?.toISOString() ?? start.toISOString(),
    licenseEndDate: created.tenant.lisansBitisTarihi?.toISOString() ?? end.toISOString(),
    licenseKey: created.tenant.lisansAnahtari,
    mailSent: mail.mailSent,
    ...(mail.mailSent ? {} : { mailError: mail.mailError })
  }
}
