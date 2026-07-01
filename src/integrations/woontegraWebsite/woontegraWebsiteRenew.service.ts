import type { Request } from 'express'
import { prisma } from '../../lib/prisma.js'
import { writeAuditLog } from '../../audit/auditService.js'
import { getRequestMeta } from '../../auth/requestMeta.js'
import { AppError } from '../../middleware/errorHandler.js'
import { sendLicenseRenewalEmail } from '../../mail/mail.service.js'
import { extendTenantLicense } from '../../tenant/extendTenantLicense.js'
import { findTenantOwner } from '../../tenant/provisionTenantWithOwner.js'
import { resolveTenantForRenewal } from '../../tenant/resolveTenantForRenewal.js'
import type { WoontegraWebsiteRenewBody } from './woontegraWebsiteRenew.schemas.js'

export type WoontegraWebsiteRenewRenewedResponse = {
  ok: true
  status: 'renewed'
  tenantId: string
  tenantSlug: string
  licenseKey: string | null
  previousEndDate: string
  newEndDate: string
  renewalDays: number
  mailSent: boolean
  mailError?: string
}

export type WoontegraWebsiteRenewAlreadyResponse = {
  ok: true
  status: 'already_renewed'
  tenantId: string
  tenantSlug: string
  licenseKey: string | null
  previousEndDate: string
  newEndDate: string
  renewalDays: number
}

export type WoontegraWebsiteRenewResponse = WoontegraWebsiteRenewRenewedResponse | WoontegraWebsiteRenewAlreadyResponse

function toRenewalResponse(
  renewal: {
    tenantId: string
    previousEndDate: Date
    newEndDate: Date
    renewalDays: number
    licenseKey: string | null
  },
  tenant: { slug: string; lisansAnahtari: string | null },
  status: 'renewed' | 'already_renewed',
  mail?: { mailSent: boolean; mailError?: string }
): WoontegraWebsiteRenewResponse {
  const base = {
    ok: true as const,
    status,
    tenantId: renewal.tenantId,
    tenantSlug: tenant.slug,
    licenseKey: renewal.licenseKey ?? tenant.lisansAnahtari,
    previousEndDate: renewal.previousEndDate.toISOString(),
    newEndDate: renewal.newEndDate.toISOString(),
    renewalDays: renewal.renewalDays
  }
  if (status === 'renewed') {
    return {
      ...base,
      status: 'renewed',
      mailSent: mail?.mailSent ?? false,
      ...(mail?.mailError ? { mailError: mail.mailError } : {})
    }
  }
  return { ...base, status: 'already_renewed' }
}

export async function renewTenantFromWoontegraWebsite(
  body: WoontegraWebsiteRenewBody,
  req: Request
): Promise<WoontegraWebsiteRenewResponse> {
  const meta = getRequestMeta(req)
  const idempotencyHeader = req.header('x-idempotency-key')?.trim()
  if (idempotencyHeader && idempotencyHeader !== body.externalOrderId) {
    throw new AppError(400, 'x-idempotency-key, externalOrderId ile aynı olmalı.', 'IDEMPOTENCY_KEY_MISMATCH')
  }

  console.info('[woontegra-website] WOONTEGRA_WEBSITE_RENEW_REQUEST', {
    externalOrderId: body.externalOrderId,
    productCode: body.productCode,
    externalCustomerId: body.externalCustomerId,
    tenantId: body.tenantId ?? null,
    hasOwnerEmail: Boolean(body.ownerEmail?.trim())
  })

  const existingRenewal = await prisma.tenantLicenseRenewal.findUnique({
    where: { externalOrderId: body.externalOrderId }
  })

  if (existingRenewal) {
    const tenant = await prisma.tenant.findUnique({ where: { id: existingRenewal.tenantId } })
    if (!tenant) throw new AppError(500, 'Yenileme kaydı var ancak büro bulunamadı.', 'NOT_FOUND')

    await writeAuditLog({
      tenantId: tenant.id,
      userId: null,
      action: 'WOONTEGRA_WEBSITE_RENEW_IDEMPOTENT_HIT',
      entityType: 'TenantLicenseRenewal',
      entityId: existingRenewal.id,
      newValue: { externalOrderId: body.externalOrderId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })

    return toRenewalResponse(existingRenewal, tenant, 'already_renewed')
  }

  const tenant = await resolveTenantForRenewal({
    externalCustomerId: body.externalCustomerId,
    tenantId: body.tenantId,
    licenseKey: body.licenseKey
  })

  const paidAt = body.billing?.paidAt ?? new Date()

  const result = await extendTenantLicense({
    tenantId: tenant.id,
    source: 'WOONTEGRA_WEBSITE',
    renewalDays: body.renewalDays,
    externalOrderId: body.externalOrderId,
    externalCustomerId: body.externalCustomerId,
    licenseKey: body.licenseKey,
    amount: body.billing?.amount ?? null,
    currency: body.billing?.currency ?? 'TRY',
    paidAt,
    note: body.notes?.trim() || 'Woontegra Website üzerinden üyelik yenileme',
    demoMu: false
  })

  await writeAuditLog({
    tenantId: tenant.id,
    userId: null,
    action: 'WOONTEGRA_WEBSITE_LICENSE_RENEWED',
    entityType: 'TenantLicenseRenewal',
    entityId: result.renewal.id,
    newValue: {
      externalOrderId: body.externalOrderId,
      previousEndDate: result.previousEndDate.toISOString(),
      newEndDate: result.newEndDate.toISOString(),
      renewalDays: result.renewalDays
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  const owner = await findTenantOwner(tenant.id)
  const email =
    owner?.eposta?.trim().toLowerCase() || body.ownerEmail?.trim().toLowerCase() || null

  let mailResult = { mailSent: false as boolean, mailError: undefined as string | undefined }
  if (email) {
    const mail = await sendLicenseRenewalEmail({
      to: email,
      buroAdi: result.tenant.buroAdi,
      lisansAnahtari: result.tenant.lisansAnahtari,
      previousEndDate: result.previousEndDate.toISOString(),
      newEndDate: result.newEndDate.toISOString(),
      renewalDays: result.renewalDays
    })
    mailResult = { mailSent: mail.sent, mailError: mail.error }
    await writeAuditLog({
      tenantId: tenant.id,
      userId: owner?.id ?? null,
      action: mail.sent ? 'LICENSE_RENEWAL_EMAIL_SENT' : 'LICENSE_RENEWAL_EMAIL_FAILED',
      entityType: 'Tenant',
      entityId: tenant.id,
      newValue: mail.sent ? {} : { error: mail.error ?? null },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
  }

  return toRenewalResponse(result.renewal, result.tenant, 'renewed', mailResult)
}
