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
  mailSent: boolean
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
    mailSent
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

  const existing = await prisma.tenant.findUnique({
    where: { externalOrderId: body.externalOrderId }
  })

  if (existing) {
    const owner = await findTenantOwner(existing.id)
    if (!owner) {
      throw new AppError(500, 'Mevcut tenant için büro sahibi bulunamadı.', 'OWNER_MISSING')
    }
    return toProvisionResponse(existing, owner, true, false)
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
        if (owner) return toProvisionResponse(raced, owner, true, false)
      }
    }
    throw e
  }

  let mailSent = false
  const ownerEmail = createdTenant.ownerUser.eposta?.trim().toLowerCase()
  if (ownerEmail) {
    try {
      const { plainToken } = await issueActivationToken(createdTenant.ownerUser.id)
      const expiresHours = getActivationTokenExpiresHours()
      mailSent = await sendWelcomeActivationEmail({
        to: ownerEmail,
        plainToken,
        buroAdi: createdTenant.tenant.buroAdi,
        kullaniciAdi: createdTenant.ownerUser.kullaniciAdi,
        lisansBaslangic:
          createdTenant.tenant.lisansBaslangicTarihi?.toISOString() ?? body.licenseStartDate.toISOString(),
        lisansBitis: createdTenant.tenant.lisansBitisTarihi?.toISOString() ?? body.licenseEndDate.toISOString(),
        activationExpiresHours: expiresHours
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(
        '[internal] activation mail failed — tenant kept, userId:',
        createdTenant.ownerUser.id.slice(0, 8),
        msg
      )
      mailSent = false
    }
  } else {
    console.warn(
      '[internal] owner has no email — activation mail skipped, userId:',
      createdTenant.ownerUser.id.slice(0, 8)
    )
  }

  return toProvisionResponse(createdTenant.tenant, createdTenant.ownerUser, false, mailSent)
}
