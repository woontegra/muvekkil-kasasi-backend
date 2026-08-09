import { createHash, randomBytes } from 'node:crypto'
import type { LicensePurchaseSessionStatus, Tenant, User } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { writeAuditLog } from '../../audit/auditService.js'
import { AppError } from '../../middleware/errorHandler.js'
import { allocateUniqueSaasLicenseKey } from '../../tenant/allocateUniqueSaasLicenseKey.js'
import { extendTenantLicense, computeExtensionBaseDate, addDaysFromBase } from '../../tenant/extendTenantLicense.js'
import { buildTenantLicenseCurrent } from '../../license/license.service.js'
import { generateUniqueMusteriNo } from '../../lib/musteriNo.js'
import { effectiveLicenseEnd } from '../../tenant/tenantLicense.js'
import type {
  LicensePurchaseBindBody,
  LicensePurchaseFulfillBody
} from './licensePurchase.schemas.js'

export const LICENSE_PURCHASE_PRODUCT_CODE = 'MUVEKKIL_KASA_SAAS' as const
/** @deprecated Yeni oturumlarda DEMO_CONVERSION kullanılır. */
export const LICENSE_PURCHASE_PURPOSE = 'LICENSE_PURCHASE' as const
export const DEMO_CONVERSION_PURPOSE = 'DEMO_CONVERSION' as const
export const LICENSE_RENEWAL_PURPOSE = 'LICENSE_RENEWAL' as const

export type LicenseSessionPurpose =
  | typeof DEMO_CONVERSION_PURPOSE
  | typeof LICENSE_RENEWAL_PURPOSE
  | typeof LICENSE_PURCHASE_PURPOSE

export type LicensePurchaseContext = 'DEMO_CONVERSION' | 'LICENSE_RENEWAL' | 'EXISTING_ACCOUNT_LICENSE'

const TOKEN_TTL_MS = 20 * 60 * 1000

export function purposeToPurchaseContext(purpose: string): LicensePurchaseContext {
  if (purpose === LICENSE_RENEWAL_PURPOSE) return 'LICENSE_RENEWAL'
  if (purpose === DEMO_CONVERSION_PURPOSE || purpose === LICENSE_PURCHASE_PURPOSE) return 'DEMO_CONVERSION'
  return 'EXISTING_ACCOUNT_LICENSE'
}

export function isExistingAccountMkSaasPurchaseContext(ctx: string | null | undefined): boolean {
  if (!ctx) return false
  return ctx === 'EXISTING_ACCOUNT_LICENSE' || ctx === 'DEMO_CONVERSION' || ctx === 'LICENSE_RENEWAL'
}

export function hashLicensePurchaseToken(plainToken: string): string {
  return createHash('sha256').update(plainToken.trim(), 'utf8').digest('hex')
}

function generatePlainLicensePurchaseToken(): string {
  return randomBytes(32).toString('base64url')
}

function woontegraWebsiteBaseUrl(): string {
  const fromEnv = process.env.WOONTEGRA_WEBSITE_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return 'https://www.woontegra.com'
}

function mkSaasProductPath(): string {
  return '/yazilimlar/muvekkil-kasa-defteri-web-tabanli'
}

function assertEligibleTenantForDemoConversion(tenant: Tenant): void {
  if (!tenant.aktifMi) {
    throw new AppError(403, 'Büro hesabı aktif değil.', 'TENANT_INACTIVE')
  }
  if (tenant.demoMu || tenant.lisansDurumu === 'DEMO') return
  throw new AppError(403, 'Lisans satın alma yalnızca demo hesaplar için.', 'LICENSE_PURCHASE_NOT_ALLOWED')
}

function assertEligibleTenantForLicenseRenewal(tenant: Tenant): void {
  if (!tenant.aktifMi) {
    throw new AppError(403, 'Büro hesabı aktif değil.', 'TENANT_INACTIVE')
  }
  if (tenant.demoMu || tenant.lisansDurumu === 'DEMO') {
    throw new AppError(403, 'Lisans yenileme demo hesaplar için kullanılamaz.', 'LICENSE_RENEWAL_NOT_ALLOWED')
  }
  if (tenant.lisansDurumu === 'AKTIF' || tenant.lisansDurumu === 'SURESI_DOLDU') return
  throw new AppError(403, 'Bu hesap için lisans yenileme kullanılamıyor.', 'LICENSE_RENEWAL_NOT_ALLOWED')
}

function assertEligibleForSessionPurpose(tenant: Tenant, purpose: LicenseSessionPurpose): void {
  if (purpose === LICENSE_RENEWAL_PURPOSE) {
    assertEligibleTenantForLicenseRenewal(tenant)
    return
  }
  assertEligibleTenantForDemoConversion(tenant)
}

async function expireSessionIfNeeded(session: {
  id: string
  expiresAt: Date
  status: LicensePurchaseSessionStatus
}): Promise<boolean> {
  if (session.expiresAt > new Date() || !['CREATED', 'BOUND'].includes(session.status)) {
    return false
  }
  await prisma.licensePurchaseSession.updateMany({
    where: { id: session.id, status: { in: ['CREATED', 'BOUND'] } },
    data: { status: 'EXPIRED' }
  })
  return true
}

function kalanGunForTenant(tenant: Tenant): number | null {
  const end = effectiveLicenseEnd(tenant)
  if (!end) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endDay = new Date(end)
  endDay.setHours(0, 0, 0, 0)
  return Math.ceil((endDay.getTime() - today.getTime()) / 86_400_000)
}

export type LicensePurchasePublicView = {
  purchaseContext: LicensePurchaseContext
  sessionId: string
  productCode: typeof LICENSE_PURCHASE_PRODUCT_CODE
  purpose: LicenseSessionPurpose
  musteriNo: string
  buroAdi: string
  demoMu: boolean
  lisansDurumu: Tenant['lisansDurumu']
  kalanGun: number | null
  lisansBitisTarihi: string | null
  lisansBaslangicTarihi: string | null
  extensionBaseDate: string
  ownerName: string | null
  ownerEmail: string | null
  ownerPhone: string | null
  tenantAdres: string | null
  tenantVergiNo: string | null
  tenantVergiDairesi: string | null
  expiresAt: string
  status: LicensePurchaseSessionStatus
  boundExternalOrderId: string | null
}

function toPublicView(
  session: {
    id: string
    status: LicensePurchaseSessionStatus
    expiresAt: Date
    boundExternalOrderId: string | null
    productCode: string
    purpose: string
  },
  tenant: Tenant,
  owner: Pick<User, 'eposta' | 'adSoyad' | 'telefon'> | null
): LicensePurchasePublicView {
  const purpose = (session.purpose === LICENSE_RENEWAL_PURPOSE
    ? LICENSE_RENEWAL_PURPOSE
    : session.purpose === DEMO_CONVERSION_PURPOSE || session.purpose === LICENSE_PURCHASE_PURPOSE
      ? DEMO_CONVERSION_PURPOSE
      : DEMO_CONVERSION_PURPOSE) as LicenseSessionPurpose
  return {
    purchaseContext: purposeToPurchaseContext(session.purpose),
    sessionId: session.id,
    productCode: LICENSE_PURCHASE_PRODUCT_CODE,
    purpose,
    musteriNo: tenant.musteriNo?.trim() || '—',
    buroAdi: tenant.buroAdi,
    demoMu: tenant.demoMu,
    lisansDurumu: tenant.lisansDurumu,
    kalanGun: kalanGunForTenant(tenant),
    lisansBitisTarihi: tenant.lisansBitisTarihi?.toISOString() ?? null,
    lisansBaslangicTarihi: tenant.lisansBaslangicTarihi?.toISOString() ?? null,
    extensionBaseDate: computeExtensionBaseDate(tenant).toISOString(),
    ownerName: owner?.adSoyad?.trim() || null,
    ownerEmail:
      owner?.eposta?.trim().toLowerCase() || tenant.eposta?.trim().toLowerCase() || null,
    ownerPhone: owner?.telefon?.trim() || tenant.telefon?.trim() || null,
    tenantAdres: tenant.adres?.trim() || null,
    tenantVergiNo: tenant.vergiNo?.trim() || null,
    tenantVergiDairesi: tenant.vergiDairesi?.trim() || null,
    expiresAt: session.expiresAt.toISOString(),
    status: session.status,
    boundExternalOrderId: session.boundExternalOrderId
  }
}

async function ensureTenantLicenseIdentifiers(tenant: Tenant): Promise<Tenant> {
  let current = tenant
  if (!current.musteriNo?.trim()) {
    await prisma.$transaction(async (tx) => {
      const musteriNo = await generateUniqueMusteriNo(tx)
      await tx.tenant.update({ where: { id: current.id }, data: { musteriNo } })
      current = { ...current, musteriNo }
    })
  }
  if (!current.lisansAnahtari?.trim()) {
    const key = await allocateUniqueSaasLicenseKey()
    current = await prisma.tenant.update({
      where: { id: current.id },
      data: { lisansAnahtari: key }
    })
  }
  return current
}

async function issueLicenseSessionLink(input: {
  userId: string
  tenantId: string
  purpose: LicenseSessionPurpose
  ipAddress?: string | null
  userAgent?: string | null
  auditAction: string
}): Promise<{ purchaseUrl: string; expiresAt: string }> {
  const user = await prisma.user.findFirst({
    where: { id: input.userId, tenantId: input.tenantId, aktifMi: true },
    include: { tenant: true }
  })
  if (!user) throw new AppError(404, 'Kullanıcı bulunamadı.', 'NOT_FOUND')
  if (user.role !== 'BURO_SAHIBI' && user.role !== 'AVUKAT_YONETICI') {
    throw new AppError(403, 'Lisans işlemi yalnızca büro yöneticileri için.', 'FORBIDDEN')
  }

  let tenant = user.tenant
  assertEligibleForSessionPurpose(tenant, input.purpose)
  tenant = await ensureTenantLicenseIdentifiers(tenant)

  const plainToken = generatePlainLicensePurchaseToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)

  await prisma.licensePurchaseSession.create({
    data: {
      tokenHash: hashLicensePurchaseToken(plainToken),
      tenantId: tenant.id,
      userId: user.id,
      purpose: input.purpose,
      productCode: LICENSE_PURCHASE_PRODUCT_CODE,
      expiresAt
    }
  })

  await writeAuditLog({
    tenantId: tenant.id,
    userId: user.id,
    action: input.auditAction,
    entityType: 'LicensePurchaseSession',
    entityId: tenant.id,
    newValue: { purpose: input.purpose, expiresAt: expiresAt.toISOString() },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  })

  const purchaseUrl = `${woontegraWebsiteBaseUrl()}${mkSaasProductPath()}?renewalToken=${encodeURIComponent(plainToken)}`
  return { purchaseUrl, expiresAt: expiresAt.toISOString() }
}

export async function issueLicensePurchaseLink(input: {
  userId: string
  tenantId: string
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<{ purchaseUrl: string; expiresAt: string }> {
  return issueLicenseSessionLink({
    ...input,
    purpose: DEMO_CONVERSION_PURPOSE,
    auditAction: 'LICENSE_PURCHASE_LINK_ISSUED'
  })
}

export async function issueLicenseRenewalLink(input: {
  userId: string
  tenantId: string
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<{ purchaseUrl: string; expiresAt: string }> {
  return issueLicenseSessionLink({
    ...input,
    purpose: LICENSE_RENEWAL_PURPOSE,
    auditAction: 'LICENSE_RENEWAL_LINK_ISSUED'
  })
}

export async function previewLicenseRenewalEnd(input: {
  renewalToken: string
  renewalDays: number
}): Promise<{
  currentLicenseEndDate: string | null
  extensionBaseDate: string
  estimatedNewEndDate: string
  renewalDays: number
}> {
  const view = await resolveLicensePurchaseToken(input.renewalToken)
  if (view.purpose !== LICENSE_RENEWAL_PURPOSE && view.purchaseContext !== 'LICENSE_RENEWAL') {
    throw new AppError(400, 'Yenileme önizlemesi yalnızca lisans yenileme için.', 'INVALID_PREVIEW')
  }
  const days = Math.max(1, Math.min(3650, Math.floor(input.renewalDays)))
  const session = await prisma.licensePurchaseSession.findUnique({
    where: { id: view.sessionId },
    include: { tenant: true }
  })
  if (!session) throw new AppError(404, 'Oturum bulunamadı.', 'NOT_FOUND')
  const base = computeExtensionBaseDate(session.tenant)
  const estimatedNewEndDate = addDaysFromBase(base, days)
  return {
    currentLicenseEndDate: session.tenant.lisansBitisTarihi?.toISOString() ?? null,
    extensionBaseDate: base.toISOString(),
    estimatedNewEndDate: estimatedNewEndDate.toISOString(),
    renewalDays: days
  }
}

export async function resolveLicensePurchaseToken(token: string): Promise<LicensePurchasePublicView> {
  if (typeof token !== 'string' || token.length < 32 || token.length > 200) {
    throw new AppError(400, 'Satın alma bağlantısı geçersiz veya süresi dolmuş.', 'INVALID_TOKEN')
  }

  const session = await prisma.licensePurchaseSession.findUnique({
    where: { tokenHash: hashLicensePurchaseToken(token) },
    include: {
      tenant: true,
      user: { select: { eposta: true, adSoyad: true, telefon: true } }
    }
  })
  if (!session) {
    throw new AppError(404, 'Satın alma bağlantısı geçersiz veya süresi dolmuş.', 'TOKEN_NOT_FOUND')
  }
  if (await expireSessionIfNeeded(session)) {
    throw new AppError(410, 'Satın alma bağlantısı geçersiz veya süresi dolmuş.', 'TOKEN_EXPIRED')
  }
  if (!['CREATED', 'BOUND'].includes(session.status)) {
    throw new AppError(409, 'Satın alma bağlantısı kullanılamıyor.', 'SESSION_UNAVAILABLE')
  }

  assertEligibleForSessionPurpose(session.tenant, session.purpose as LicenseSessionPurpose)
  if (session.productCode !== LICENSE_PURCHASE_PRODUCT_CODE) {
    throw new AppError(409, 'Ürün eşleşmesi geçersiz.', 'PRODUCT_MISMATCH')
  }

  return toPublicView(session, session.tenant, session.user)
}

export async function bindLicensePurchaseToken(body: LicensePurchaseBindBody): Promise<LicensePurchasePublicView> {
  const token = body.renewalToken
  if (typeof token !== 'string' || token.length < 32 || token.length > 200) {
    throw new AppError(400, 'Satın alma bağlantısı geçersiz veya süresi dolmuş.', 'INVALID_TOKEN')
  }

  const externalOrderId = body.externalOrderId.trim()
  const session = await prisma.licensePurchaseSession.findUnique({
    where: { tokenHash: hashLicensePurchaseToken(token) },
    include: {
      tenant: true,
      user: { select: { eposta: true, adSoyad: true, telefon: true } }
    }
  })
  if (!session) {
    throw new AppError(404, 'Satın alma bağlantısı geçersiz veya süresi dolmuş.', 'TOKEN_NOT_FOUND')
  }
  if (await expireSessionIfNeeded(session)) {
    throw new AppError(410, 'Satın alma bağlantısı geçersiz veya süresi dolmuş.', 'TOKEN_EXPIRED')
  }
  if (!['CREATED', 'BOUND'].includes(session.status)) {
    throw new AppError(409, 'Satın alma bağlantısı kullanılamıyor.', 'SESSION_UNAVAILABLE')
  }

  if (session.boundExternalOrderId) {
    if (session.boundExternalOrderId !== externalOrderId) {
      throw new AppError(409, 'Satın alma bağlantısı başka bir siparişe bağlı.', 'TOKEN_ALREADY_BOUND')
    }
    return toPublicView(session, session.tenant, session.user)
  }

  const updated = await prisma.licensePurchaseSession.updateMany({
    where: {
      id: session.id,
      status: 'CREATED',
      boundExternalOrderId: null,
      expiresAt: { gt: new Date() }
    },
    data: {
      status: 'BOUND',
      boundExternalOrderId: externalOrderId,
      boundAt: new Date()
    }
  })
  if (updated.count !== 1) {
    throw new AppError(409, 'Satın alma bağlantısı bağlanamadı.', 'TOKEN_BIND_CONFLICT')
  }

  const fresh = await prisma.licensePurchaseSession.findUniqueOrThrow({
    where: { id: session.id },
    include: {
      tenant: true,
      user: { select: { eposta: true, adSoyad: true, telefon: true } }
    }
  })
  return toPublicView(fresh, fresh.tenant, fresh.user)
}

export type LicensePurchaseFulfillResponse = {
  ok: true
  status: 'licensed' | 'already_licensed'
  tenantId: string
  tenantSlug: string
  licenseKey: string | null
  previousEndDate: string
  newEndDate: string
  renewalDays: number
  demoMu: boolean
}

export async function fulfillLicensePurchase(body: LicensePurchaseFulfillBody): Promise<LicensePurchaseFulfillResponse> {
  const externalOrderId = body.externalOrderId.trim()
  if (body.productCode !== LICENSE_PURCHASE_PRODUCT_CODE) {
    throw new AppError(409, 'Ürün eşleşmesi geçersiz.', 'PRODUCT_MISMATCH')
  }

  const existingRenewal = await prisma.tenantLicenseRenewal.findUnique({
    where: { externalOrderId }
  })
  if (existingRenewal) {
    const tenant = await prisma.tenant.findUnique({ where: { id: existingRenewal.tenantId } })
    if (!tenant) throw new AppError(500, 'Lisans kaydı var ancak büro bulunamadı.', 'NOT_FOUND')
    return {
      ok: true,
      status: 'already_licensed',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      licenseKey: existingRenewal.licenseKey ?? tenant.lisansAnahtari,
      previousEndDate: existingRenewal.previousEndDate.toISOString(),
      newEndDate: existingRenewal.newEndDate.toISOString(),
      renewalDays: existingRenewal.renewalDays,
      demoMu: tenant.demoMu
    }
  }

  const session = await prisma.licensePurchaseSession.findUnique({
    where: { boundExternalOrderId: externalOrderId },
    include: { tenant: true }
  })
  if (!session) {
    throw new AppError(404, 'Mevcut hesap lisans oturumu bulunamadı.', 'SESSION_NOT_FOUND')
  }
  if (session.status === 'CONSUMED') {
    const renewal = await prisma.tenantLicenseRenewal.findUnique({ where: { externalOrderId } })
    if (renewal) {
      return {
        ok: true,
        status: 'already_licensed',
        tenantId: session.tenantId,
        tenantSlug: session.tenant.slug,
        licenseKey: renewal.licenseKey ?? session.tenant.lisansAnahtari,
        previousEndDate: renewal.previousEndDate.toISOString(),
        newEndDate: renewal.newEndDate.toISOString(),
        renewalDays: renewal.renewalDays,
        demoMu: session.tenant.demoMu
      }
    }
  }
  if (!['BOUND', 'CONSUMED'].includes(session.status)) {
    throw new AppError(409, 'Lisans oturumu ödeme için hazır değil.', 'SESSION_NOT_BOUND')
  }

  let tenant = session.tenant
  if (!tenant.lisansAnahtari?.trim()) {
    const key = await allocateUniqueSaasLicenseKey()
    tenant = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { lisansAnahtari: key }
    })
  }

  const paidAt = body.billing?.paidAt ?? new Date()
  const isRenewal = session.purpose === LICENSE_RENEWAL_PURPOSE
  const result = await extendTenantLicense({
    tenantId: tenant.id,
    source: 'WOONTEGRA_WEBSITE',
    renewalDays: body.renewalDays,
    externalOrderId,
    externalCustomerId: body.externalCustomerId?.trim() || tenant.externalCustomerId,
    licenseKey: tenant.lisansAnahtari,
    amount: body.billing?.amount ?? null,
    currency: body.billing?.currency ?? 'TRY',
    paidAt,
    note: body.notes?.trim() || (isRenewal
      ? 'Woontegra Website — mevcut hesap lisans yenileme'
      : 'Woontegra Website — mevcut hesap lisanslama'),
    demoMu: false,
    appendLicenseNote: isRenewal
      ? 'Lisans yenileme (mevcut hesap korundu).'
      : 'Demo → ücretli lisans (mevcut hesap korundu).'
  })

  if (body.externalCustomerId?.trim() && body.externalCustomerId.trim() !== tenant.externalCustomerId) {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { externalCustomerId: body.externalCustomerId.trim() }
    })
  }

  await prisma.licensePurchaseSession.update({
    where: { id: session.id },
    data: { status: 'CONSUMED', consumedAt: new Date() }
  })

  await writeAuditLog({
    tenantId: tenant.id,
    userId: session.userId,
    action: isRenewal ? 'LICENSE_RENEWAL_FULFILLED' : 'LICENSE_PURCHASE_FULFILLED',
    entityType: 'TenantLicenseRenewal',
    entityId: result.renewal.id,
    newValue: {
      externalOrderId,
      previousEndDate: result.previousEndDate.toISOString(),
      newEndDate: result.newEndDate.toISOString(),
      renewalDays: result.renewalDays
    },
    ipAddress: null,
    userAgent: null
  })

  return {
    ok: true,
    status: 'licensed',
    tenantId: result.tenant.id,
    tenantSlug: result.tenant.slug,
    licenseKey: result.tenant.lisansAnahtari,
    previousEndDate: result.previousEndDate.toISOString(),
    newEndDate: result.newEndDate.toISOString(),
    renewalDays: result.renewalDays,
    demoMu: result.tenant.demoMu
  }
}

export function buildLicensePurchaseSummaryForTenant(tenant: Tenant) {
  return buildTenantLicenseCurrent(tenant, 'BURO_SAHIBI')
}
