import { Prisma, type Tenant, type User } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { slugifyBuroAdi } from '../lib/slug.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import { writeAdminAuditLog } from '../admin/adminAudit.service.js'
import { allocateUniqueSaasLicenseKey } from './allocateUniqueSaasLicenseKey.js'
import { generateUniqueMusteriNo } from '../lib/musteriNo.js'

export type ProvisionTenantOwnerInput = {
  adSoyad: string
  kullaniciAdi: string
  eposta?: string | null
  telefon?: string | null
  sifreHash: string
  mustChangePassword?: boolean
  licenseActivatedAt?: Date | null
}

export type ProvisionTenantInput = {
  buroAdi: string
  slug?: string | null
  telefon?: string | null
  eposta?: string | null
  adres?: string | null
  vergiNo?: string | null
  vergiDairesi?: string | null
  aktifMi?: boolean
  lisansBaslangicTarihi: Date
  lisansBitisTarihi: Date
  lisansDurumu: 'DEMO' | 'AKTIF' | 'PASIF' | 'SURESI_DOLDU'
  demoMu: boolean
  demoBitisTarihi: Date | null
  yillikUcret?: number | null
  sonOdemeTarihi?: Date | null
  lisansNotlari?: string | null
  lisansAnahtari?: string | null
  externalOrderId?: string | null
  externalCustomerId?: string | null
  owner: ProvisionTenantOwnerInput
}

export type ProvisionAuditMeta =
  | {
      source: 'ADMIN'
      adminId: string
      ipAddress?: string | null
      userAgent?: string | null
    }
  | {
      source: 'WOONTEGRA_WEBSITE'
      ipAddress?: string | null
      userAgent?: string | null
    }

function strOrNull(s: string | undefined | null): string | null {
  const t = s?.trim()
  return t ? t : null
}

export async function ensureUniqueTenantSlug(buroAdi: string, preferredSlug?: string | null): Promise<string> {
  const base = preferredSlug?.trim()
    ? slugifyBuroAdi(preferredSlug) || slugifyBuroAdi(buroAdi) || 'buro'
    : slugifyBuroAdi(buroAdi) || 'buro'
  let slug = base
  let n = 0
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    n += 1
    slug = `${base}-${n}`
  }
  return slug
}

async function assertUsernameAvailable(kullaniciAdi: string, excludeUserId?: string): Promise<void> {
  const taken = await prisma.user.findFirst({
    where: {
      kullaniciAdi: { equals: kullaniciAdi, mode: 'insensitive' },
      ...(excludeUserId ? { NOT: { id: excludeUserId } } : {})
    }
  })
  if (taken) {
    throw new AppError(409, 'Bu kullanıcı adı zaten kullanılıyor.', 'USERNAME_TAKEN')
  }
}

/**
 * Tenant + büro sahibi oluşturma çekirdeği (süper admin paneli).
 */
export async function provisionTenantWithOwner(
  input: ProvisionTenantInput,
  audit: ProvisionAuditMeta
): Promise<{ tenant: Tenant; ownerUser: User }> {
  const ownerLower = input.owner.kullaniciAdi
  await assertUsernameAvailable(ownerLower)

  const slug = await ensureUniqueTenantSlug(input.buroAdi, input.slug)
  const tenantEposta = strOrNull(input.eposta)?.toLowerCase() ?? null
  const ownerEposta = strOrNull(input.owner.eposta)?.toLowerCase() ?? null

  try {
    const result = await prisma.$transaction(async (tx) => {
      const lisansAnahtari = input.lisansAnahtari ?? (await allocateUniqueSaasLicenseKey(tx))
      const musteriNo = await generateUniqueMusteriNo(tx)

      const tenant = await tx.tenant.create({
        data: {
          buroAdi: input.buroAdi.trim(),
          slug,
          musteriNo,
          telefon: strOrNull(input.telefon),
          eposta: tenantEposta,
          adres: strOrNull(input.adres),
          vergiNo: strOrNull(input.vergiNo),
          vergiDairesi: strOrNull(input.vergiDairesi),
          aktifMi: input.aktifMi ?? true,
          lisansBaslangicTarihi: input.lisansBaslangicTarihi,
          lisansBitisTarihi: input.lisansBitisTarihi,
          lisansDurumu: input.lisansDurumu,
          demoMu: input.demoMu,
          demoBitisTarihi: input.demoBitisTarihi,
          yillikUcret: input.yillikUcret != null ? new Prisma.Decimal(input.yillikUcret) : null,
          sonOdemeTarihi: input.sonOdemeTarihi ?? null,
          lisansNotlari: strOrNull(input.lisansNotlari),
          lisansAnahtari,
          externalOrderId: strOrNull(input.externalOrderId),
          externalCustomerId: strOrNull(input.externalCustomerId)
        }
      })

      const ownerUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          adSoyad: input.owner.adSoyad.trim(),
          kullaniciAdi: ownerLower,
          eposta: ownerEposta,
          telefon: strOrNull(input.owner.telefon),
          sifreHash: input.owner.sifreHash,
          role: 'BURO_SAHIBI',
          aktifMi: true,
          mustChangePassword: input.owner.mustChangePassword ?? false,
          licenseActivatedAt: input.owner.licenseActivatedAt ?? undefined
        }
      })

      return { tenant, ownerUser }
    })

    if (audit.source === 'ADMIN') {
      await writeAdminAuditLog({
        adminId: audit.adminId,
        action: 'TENANT_CREATED_BY_ADMIN',
        entityType: 'Tenant',
        entityId: result.tenant.id,
        newValue: {
          tenantId: result.tenant.id,
          buroAdi: result.tenant.buroAdi,
          ownerUserId: result.ownerUser.id,
          lisansDurumu: result.tenant.lisansDurumu,
          lisansBitisTarihi: result.tenant.lisansBitisTarihi?.toISOString() ?? null,
          adminId: audit.adminId
        } as unknown as Prisma.InputJsonValue,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent
      })
    }

    const officeAction =
      audit.source === 'WOONTEGRA_WEBSITE' ? 'TENANT_CREATED_FROM_WOONTEGRA_WEBSITE' : 'OFFICE_CREATED_BY_ADMIN'
    const userAction =
      audit.source === 'WOONTEGRA_WEBSITE' ? 'USER_CREATED_FROM_WOONTEGRA_WEBSITE' : 'USER_CREATED_BY_ADMIN'

    await writeAuditLog({
      tenantId: result.tenant.id,
      userId: null,
      action: officeAction,
      entityType: 'Tenant',
      entityId: result.tenant.id,
      newValue: {
        slug: result.tenant.slug,
        externalOrderId: result.tenant.externalOrderId,
        lisansAnahtari: result.tenant.lisansAnahtari,
        source: audit.source,
        ...(audit.source === 'ADMIN' ? { adminId: audit.adminId } : {})
      },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent
    })

    await writeAuditLog({
      tenantId: result.tenant.id,
      userId: null,
      action: 'SAAS_LICENSE_CREATED',
      entityType: 'Tenant',
      entityId: result.tenant.id,
      newValue: {
        lisansAnahtari: result.tenant.lisansAnahtari,
        lisansBaslangicTarihi: result.tenant.lisansBaslangicTarihi?.toISOString() ?? null,
        lisansBitisTarihi: result.tenant.lisansBitisTarihi?.toISOString() ?? null,
        lisansDurumu: result.tenant.lisansDurumu,
        source: audit.source
      },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent
    })

    await writeAuditLog({
      tenantId: result.tenant.id,
      userId: result.ownerUser.id,
      action: userAction,
      entityType: 'User',
      entityId: result.ownerUser.id,
      newValue: {
        kullaniciAdi: result.ownerUser.kullaniciAdi,
        source: audit.source,
        ...(audit.source === 'ADMIN' ? { adminId: audit.adminId } : {})
      },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent
    })

    return result
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: string }).code) : ''
    if (code === 'P2002') {
      throw new AppError(
        409,
        'Büro veya kullanıcı bilgisi çakışıyor (ör. kullanıcı adı, e-posta veya sipariş kimliği).',
        'DUPLICATE'
      )
    }
    throw e
  }
}

export async function findTenantOwner(tenantId: string): Promise<User | null> {
  return prisma.user.findFirst({
    where: { tenantId, role: 'BURO_SAHIBI' },
    orderBy: { createdAt: 'asc' }
  })
}
