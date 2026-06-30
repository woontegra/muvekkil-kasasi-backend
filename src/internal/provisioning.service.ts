import crypto from 'node:crypto'
import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'
import { getFrontendBaseUrl } from '../mail/mail.config.js'
import { sendWelcomeActivationEmail } from '../mail/mail.service.js'
import { issueActivationToken } from '../auth/passwordReset.service.js'
import { hashPassword } from '../admin/adminAuth.service.js'
import { getActivationTokenExpiresHours } from '../config/env.js'
import { AppError } from '../middleware/errorHandler.js'
import { findTenantOwner, provisionTenantWithOwner } from '../tenant/provisionTenantWithOwner.js'
import { normalizeKullaniciAdi } from '../lib/normalizeKullaniciAdi.js'
import type { ProvisionTenantBody } from './provisioning.schemas.js'
import { getRequestMeta } from '../auth/requestMeta.js'

export type ProvisionTenantResult = {
  ok: true
  idempotentReplay: boolean
  tenant: {
    id: string
    slug: string
    lisansDurumu: string
    lisansBitisTarihi: string | null
  }
  ownerUser: {
    id: string
    kullaniciAdi: string
    eposta: string | null
  }
  loginUrl: string
  mailSent: boolean
  mailError?: string
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain || !local) return '***'
  const visible = local.length <= 2 ? (local[0] ?? '*') : `${local.slice(0, 2)}***`
  return `${visible}@${domain}`
}

function buildLicenseNotes(body: ProvisionTenantBody): string | null {
  const parts: string[] = []
  if (body.notes?.trim()) parts.push(body.notes.trim())
  parts.push(`productCode=${body.productCode}`)
  if (body.licenseType) parts.push(`licenseType=${body.licenseType}`)
  if (body.billing?.currency) parts.push(`currency=${body.billing.currency}`)
  return parts.length ? parts.join(' | ') : null
}

function resolveOwnerUsername(body: ProvisionTenantBody): string {
  if (body.owner.username?.trim()) return body.owner.username
  if (body.owner.email?.trim()) {
    const fromEmail = normalizeKullaniciAdi(body.owner.email.split('@')[0] ?? '')
    if (fromEmail.length >= 3) return fromEmail
  }
  throw new AppError(422, 'Geçerli owner.username üretilemedi.', 'VALIDATION_ERROR')
}

function toProvisionResponse(
  tenant: { id: string; slug: string; lisansDurumu: string; lisansBitisTarihi: Date | null },
  owner: { id: string; kullaniciAdi: string; eposta: string | null },
  idempotentReplay: boolean,
  mailSent: boolean,
  mailError?: string
): ProvisionTenantResult {
  return {
    ok: true,
    idempotentReplay,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      lisansDurumu: tenant.lisansDurumu,
      lisansBitisTarihi: tenant.lisansBitisTarihi?.toISOString() ?? null
    },
    ownerUser: {
      id: owner.id,
      kullaniciAdi: owner.kullaniciAdi,
      eposta: owner.eposta
    },
    loginUrl: `${getFrontendBaseUrl()}/login`,
    mailSent,
    ...(mailSent ? {} : { mailError: mailError ?? 'MAIL_SEND_FAILED' })
  }
}

async function sendOwnerActivationEmail(
  tenant: {
    id: string
    buroAdi: string
    lisansBaslangicTarihi: Date | null
    lisansBitisTarihi: Date | null
  },
  owner: { id: string; kullaniciAdi: string; eposta: string | null },
  fallback: { ownerEmail?: string; licenseStart: string; licenseEnd: string }
): Promise<{ mailSent: boolean; mailError?: string }> {
  const email = (owner.eposta?.trim() || fallback.ownerEmail?.trim())?.toLowerCase()
  if (!email) {
    console.warn('[internal] activation mail skipped — no owner email', {
      tenantId: tenant.id,
      userId: owner.id.slice(0, 8)
    })
    return { mailSent: false, mailError: 'OWNER_EMAIL_MISSING' }
  }

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
      activationExpiresHours: getActivationTokenExpiresHours()
    })
    if (!result.sent) {
      const error = result.error ?? 'MAIL_SEND_FAILED'
      console.error('[internal] activation mail not sent', {
        tenantId: tenant.id,
        recipient: toMasked,
        error
      })
      return { mailSent: false, mailError: error }
    }
    console.info('[internal] activation mail sent', { tenantId: tenant.id, recipient: toMasked })
    return { mailSent: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[internal] activation mail failed', {
      tenantId: tenant.id,
      recipient: toMasked,
      error: msg
    })
    return { mailSent: false, mailError: msg }
  }
}

export async function provisionTenantFromCentralLicense(
  body: ProvisionTenantBody,
  req: Request
): Promise<ProvisionTenantResult> {
  const meta = getRequestMeta(req)
  const idempotencyKey = req.provisioningIdempotencyKey?.trim()
  if (idempotencyKey && idempotencyKey !== body.externalOrderId) {
    console.warn(
      '[internal] x-idempotency-key body.externalOrderId ile uyuşmuyor — body kullanılıyor:',
      idempotencyKey,
      '!=',
      body.externalOrderId
    )
  } else if (!idempotencyKey) {
    console.warn('[internal] x-idempotency-key header yok — body.externalOrderId kullanılıyor:', body.externalOrderId)
  }

  const mailFallback = {
    ownerEmail: body.owner.email,
    licenseStart: body.licenseStartDate.toISOString(),
    licenseEnd: body.licenseEndDate.toISOString()
  }

  const existing = await prisma.tenant.findUnique({
    where: { externalOrderId: body.externalOrderId }
  })

  if (existing) {
    const owner = await findTenantOwner(existing.id)
    if (!owner) {
      throw new AppError(500, 'Mevcut tenant için büro sahibi bulunamadı.', 'OWNER_MISSING')
    }
    const mail = await sendOwnerActivationEmail(existing, owner, mailFallback)
    return toProvisionResponse(existing, owner, true, mail.mailSent, mail.mailError)
  }

  const isDemo = body.licenseStatus === 'DEMO'
  const kullaniciAdi = resolveOwnerUsername(body)
  const randomSecret = crypto.randomBytes(32).toString('base64url')
  const sifreHash = await hashPassword(randomSecret)

  let createdTenant: Awaited<ReturnType<typeof provisionTenantWithOwner>>

  try {
    createdTenant = await provisionTenantWithOwner(
      {
        buroAdi: body.tenant.name,
        slug: body.tenant.slug,
        telefon: body.tenant.phone,
        eposta: body.tenant.email,
        adres: body.tenant.address,
        vergiNo: body.tenant.taxNo,
        vergiDairesi: body.tenant.taxOffice,
        aktifMi: true,
        lisansBaslangicTarihi: body.licenseStartDate,
        lisansBitisTarihi: body.licenseEndDate,
        lisansDurumu: isDemo ? 'DEMO' : 'AKTIF',
        demoMu: isDemo,
        demoBitisTarihi: isDemo ? body.licenseEndDate : null,
        yillikUcret: body.billing?.amount ?? null,
        sonOdemeTarihi: body.billing?.paidAt ?? null,
        lisansNotlari: buildLicenseNotes(body),
        externalOrderId: body.externalOrderId,
        externalCustomerId: body.externalCustomerId ?? null,
        owner: {
          adSoyad: body.owner.fullName,
          kullaniciAdi,
          eposta: body.owner.email,
          telefon: body.owner.phone,
          sifreHash
        }
      },
      {
        source: 'PROVISIONING',
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
          const mail = await sendOwnerActivationEmail(raced, owner, mailFallback)
          return toProvisionResponse(raced, owner, true, mail.mailSent, mail.mailError)
        }
      }
    }
    throw e
  }

  const mail = await sendOwnerActivationEmail(createdTenant.tenant, createdTenant.ownerUser, mailFallback)
  return toProvisionResponse(createdTenant.tenant, createdTenant.ownerUser, false, mail.mailSent, mail.mailError)
}
