import { prisma } from '../lib/prisma.js'
import { adminListExpiringTenants } from './adminTenant.service.js'

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

async function listRecentTenants(take: number) {
  return prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      buroAdi: true,
      slug: true,
      eposta: true,
      lisansDurumu: true,
      createdAt: true
    }
  })
}

async function listBugunGirisYapanBurolar() {
  const today = startOfToday()
  const rows = await prisma.user.findMany({
    where: { sonGirisTarihi: { gte: today } },
    distinct: ['tenantId'],
    select: { tenantId: true }
  })
  const ids = rows.map((r) => r.tenantId).filter(Boolean) as string[]
  if (ids.length === 0) return []
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: ids } },
    orderBy: { buroAdi: 'asc' },
    select: {
      id: true,
      buroAdi: true,
      slug: true,
      eposta: true,
      telefon: true,
      lisansDurumu: true,
      aktifMi: true
    }
  })
  return tenants.map((t) => ({
    id: t.id,
    buroAdi: t.buroAdi,
    slug: t.slug,
    eposta: t.eposta,
    telefon: t.telefon,
    lisansDurumu: t.lisansDurumu,
    aktifMi: t.aktifMi
  }))
}

async function listSonAdminAuditLogs(take: number) {
  const logs = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      admin: { select: { adSoyad: true, kullaniciAdi: true } }
    }
  })
  return logs.map((l) => ({
    id: l.id,
    action: l.action,
    entityType: l.entityType,
    entityId: l.entityId,
    createdAt: l.createdAt.toISOString(),
    adminAdSoyad: l.admin?.adSoyad ?? null,
    adminKullaniciAdi: l.admin?.kullaniciAdi ?? null
  }))
}

export async function getAdminDashboardStats() {
  const today = startOfToday()

  const [
    toplamBuro,
    aktifBuro,
    demoBuro,
    suresiDolanBuro,
    pasifBuro,
    toplamKullanici,
    toplamMuvekkil,
    toplamDosya,
    distinctToday,
    lisansi7GunIcindeBitecekler,
    sonKayitOlanBurolar,
    bugunGirisYapanBurolar,
    sonAdminAuditLoglar
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { aktifMi: true, lisansDurumu: { not: 'PASIF' } } }),
    prisma.tenant.count({ where: { lisansDurumu: 'DEMO' } }),
    prisma.tenant.count({ where: { lisansDurumu: 'SURESI_DOLDU' } }),
    prisma.tenant.count({ where: { OR: [{ aktifMi: false }, { lisansDurumu: 'PASIF' }] } }),
    prisma.user.count(),
    prisma.muvekkil.count(),
    prisma.dosya.count(),
    prisma.user.findMany({
      where: { sonGirisTarihi: { gte: today } },
      distinct: ['tenantId'],
      select: { tenantId: true }
    }),
    adminListExpiringTenants(7),
    listRecentTenants(10),
    listBugunGirisYapanBurolar(),
    listSonAdminAuditLogs(20)
  ])

  const sonKayitSerialized = sonKayitOlanBurolar.map((t) => ({
    ...t,
    createdAt: t.createdAt.toISOString()
  }))

  return {
    toplamBuro,
    aktifBuro,
    demoBuro,
    suresiDolanBuro,
    pasifBuro,
    toplamKullanici,
    toplamMuvekkil,
    toplamDosya,
    bugunGirisYapanBuro: distinctToday.length,
    lisansi7GunIcindeBitecekler,
    sonKayitOlanBurolar: sonKayitSerialized,
    bugunGirisYapanBurolar,
    sonAdminAuditLoglar
  }
}
