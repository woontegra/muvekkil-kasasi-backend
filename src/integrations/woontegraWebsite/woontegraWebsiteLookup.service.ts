import { prisma } from '../../lib/prisma.js'

export type WoontegraWebsiteEmailLookupResult = {
  ok: true
  email: string
  found: boolean
  records: Array<{
    userId: string
    kullaniciAdi: string
    ownerEmail: string
    role: string
    userActive: boolean
    tenant: {
      tenantId: string
      tenantSlug: string
      tenantName: string
      tenantActive: boolean
      licenseStatus: string
      licenseKey: string | null
      externalOrderId: string | null
      externalCustomerId: string | null
      licenseStartDate: string | null
      licenseEndDate: string | null
      createdAt: string
    } | null
  }>
}

export async function lookupTenantsByOwnerEmail(email: string): Promise<WoontegraWebsiteEmailLookupResult> {
  const normalized = email.trim().toLowerCase()
  const users = await prisma.user.findMany({
    where: { eposta: { equals: normalized, mode: 'insensitive' } },
    include: {
      tenant: {
        select: {
          id: true,
          slug: true,
          buroAdi: true,
          aktifMi: true,
          lisansAnahtari: true,
          lisansDurumu: true,
          externalOrderId: true,
          externalCustomerId: true,
          lisansBaslangicTarihi: true,
          lisansBitisTarihi: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return {
    ok: true,
    email: normalized,
    found: users.length > 0,
    records: users.map((u) => ({
      userId: u.id,
      kullaniciAdi: u.kullaniciAdi,
      ownerEmail: u.eposta?.trim().toLowerCase() ?? normalized,
      role: u.role,
      userActive: u.aktifMi,
      tenant: u.tenant
        ? {
            tenantId: u.tenant.id,
            tenantSlug: u.tenant.slug,
            tenantName: u.tenant.buroAdi,
            tenantActive: u.tenant.aktifMi,
            licenseStatus: u.tenant.lisansDurumu,
            licenseKey: u.tenant.lisansAnahtari,
            externalOrderId: u.tenant.externalOrderId,
            externalCustomerId: u.tenant.externalCustomerId,
            licenseStartDate: u.tenant.lisansBaslangicTarihi?.toISOString() ?? null,
            licenseEndDate: u.tenant.lisansBitisTarihi?.toISOString() ?? null,
            createdAt: u.tenant.createdAt.toISOString(),
          }
        : null,
    })),
  }
}
