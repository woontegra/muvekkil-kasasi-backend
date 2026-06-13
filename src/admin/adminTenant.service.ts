import { Prisma, type SuperAdminRole, type Tenant } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { slugifyBuroAdi } from '../lib/slug.js'
import { serializeTenant, serializeUser } from '../auth/auth.service.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import { writeAdminAuditLog } from './adminAudit.service.js'
import { hashPassword } from './adminAuth.service.js'
import type { Request } from 'express'
import { getRequestMeta } from '../auth/requestMeta.js'
import type { z } from 'zod'
import {
  adminExtendLicenseBodySchema,
  adminTenantUpdateBodySchema,
  adminUserUpdateBodySchema,
  type AdminCreateTenantBody
} from './admin.schemas.js'
import crypto from 'node:crypto'

type TenantUpdateBody = z.infer<typeof adminTenantUpdateBodySchema>
type ExtendBody = z.infer<typeof adminExtendLicenseBodySchema>
type UserUpdateBody = z.infer<typeof adminUserUpdateBodySchema>

function dec(d: { toString: () => string } | null | undefined): string | null {
  if (d == null) return null
  return d.toString()
}

function stripForDestek(body: TenantUpdateBody): TenantUpdateBody {
  const allowed: (keyof TenantUpdateBody)[] = ['buroAdi', 'telefon', 'eposta', 'adres', 'vergiNo', 'vergiDairesi']
  const out: TenantUpdateBody = {}
  for (const k of allowed) {
    if (body[k] !== undefined) (out as Record<string, unknown>)[k] = body[k]
  }
  return out
}

function stripForFinans(body: TenantUpdateBody): TenantUpdateBody {
  const allowed: (keyof TenantUpdateBody)[] = [
    'buroAdi',
    'telefon',
    'eposta',
    'adres',
    'vergiNo',
    'vergiDairesi',
    'lisansDurumu',
    'lisansBaslangicTarihi',
    'lisansBitisTarihi',
    'demoMu',
    'demoBitisTarihi',
    'sonOdemeTarihi',
    'yillikUcret',
    'lisansNotlari'
  ]
  const out: TenantUpdateBody = {}
  for (const k of allowed) {
    if (body[k] !== undefined) (out as Record<string, unknown>)[k] = body[k]
  }
  return out
}

export async function adminListTenants(params: {
  q?: string
  lisansDurumu?: string
  aktifMi?: boolean
  page: number
  limit: number
}) {
  const where: Prisma.TenantWhereInput = {}
  if (params.q?.trim()) {
    const q = params.q.trim()
    where.OR = [
      { buroAdi: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q, mode: 'insensitive' } },
      { eposta: { contains: q, mode: 'insensitive' } }
    ]
  }
  if (params.lisansDurumu) {
    where.lisansDurumu = params.lisansDurumu as Tenant['lisansDurumu']
  }
  if (params.aktifMi !== undefined) {
    where.aktifMi = params.aktifMi
  }

  const [total, rows] = await Promise.all([
    prisma.tenant.count({ where }),
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      include: {
        _count: { select: { users: true, muvekkiller: true, dosyalar: true } }
      }
    })
  ])

  const items = rows.map((t) => ({
    id: t.id,
    buroAdi: t.buroAdi,
    slug: t.slug,
    eposta: t.eposta,
    telefon: t.telefon,
    aktifMi: t.aktifMi,
    lisansDurumu: t.lisansDurumu,
    lisansBaslangicTarihi: t.lisansBaslangicTarihi?.toISOString() ?? null,
    lisansBitisTarihi: t.lisansBitisTarihi?.toISOString() ?? null,
    demoMu: t.demoMu,
    demoBitisTarihi: t.demoBitisTarihi?.toISOString() ?? null,
    toplamKullanici: t._count.users,
    toplamMuvekkil: t._count.muvekkiller,
    toplamDosya: t._count.dosyalar,
    createdAt: t.createdAt.toISOString()
  }))

  return { items, total, page: params.page, limit: params.limit }
}

export async function adminGetTenant(id: string) {
  const t = await prisma.tenant.findUnique({
    where: { id },
    include: {
      users: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          adSoyad: true,
          kullaniciAdi: true,
          eposta: true,
          telefon: true,
          role: true,
          aktifMi: true,
          sonGirisTarihi: true,
          createdAt: true
        }
      },
      _count: {
        select: {
          users: true,
          muvekkiller: true,
          dosyalar: true,
          kasaHareketleri: true,
          auditLogs: true
        }
      }
    }
  })
  if (!t) throw new AppError(404, 'Büro bulunamadı.', 'NOT_FOUND')

  const [auditLogs, kasaCount] = await Promise.all([
    prisma.auditLog.findMany({
      where: { tenantId: id },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        userId: true
      }
    }),
    prisma.kasaHareketi.count({ where: { tenantId: id } })
  ])

  return {
    tenant: {
      id: t.id,
      buroAdi: t.buroAdi,
      slug: t.slug,
      telefon: t.telefon,
      eposta: t.eposta,
      adres: t.adres,
      vergiNo: t.vergiNo,
      vergiDairesi: t.vergiDairesi,
      aktifMi: t.aktifMi,
      lisansBaslangicTarihi: t.lisansBaslangicTarihi?.toISOString() ?? null,
      lisansBitisTarihi: t.lisansBitisTarihi?.toISOString() ?? null,
      lisansDurumu: t.lisansDurumu,
      demoMu: t.demoMu,
      demoBitisTarihi: t.demoBitisTarihi?.toISOString() ?? null,
      sonOdemeTarihi: t.sonOdemeTarihi?.toISOString() ?? null,
      yillikUcret: dec(t.yillikUcret),
      lisansNotlari: t.lisansNotlari,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString()
    },
    kullanicilar: t.users.map((u) => ({
      ...u,
      sonGirisTarihi: u.sonGirisTarihi?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString()
    })),
    ozet: {
      toplamKullanici: t._count.users,
      toplamMuvekkil: t._count.muvekkiller,
      toplamDosya: t._count.dosyalar,
      kasaHareketi: kasaCount,
      auditKayit: t._count.auditLogs
    },
    sonAuditLoglar: auditLogs.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString()
    }))
  }
}

export async function adminUpdateTenant(
  id: string,
  body: TenantUpdateBody,
  role: SuperAdminRole,
  adminId: string,
  req: Request
): Promise<Tenant> {
  const existing = await prisma.tenant.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, 'Büro bulunamadı.', 'NOT_FOUND')

  let patch: TenantUpdateBody = body
  if (role === 'DESTEK') patch = stripForDestek(body)
  else if (role === 'FINANS') patch = stripForFinans(body)

  const data: Prisma.TenantUpdateInput = {}
  if (patch.buroAdi !== undefined) data.buroAdi = patch.buroAdi
  if (patch.telefon !== undefined) data.telefon = patch.telefon
  if (patch.eposta !== undefined) data.eposta = patch.eposta
  if (patch.adres !== undefined) data.adres = patch.adres
  if (patch.vergiNo !== undefined) data.vergiNo = patch.vergiNo
  if (patch.vergiDairesi !== undefined) data.vergiDairesi = patch.vergiDairesi
  if (patch.aktifMi !== undefined) data.aktifMi = patch.aktifMi
  if (patch.lisansDurumu !== undefined) data.lisansDurumu = patch.lisansDurumu
  if (patch.lisansBaslangicTarihi !== undefined) data.lisansBaslangicTarihi = patch.lisansBaslangicTarihi
  if (patch.lisansBitisTarihi !== undefined) data.lisansBitisTarihi = patch.lisansBitisTarihi
  if (patch.demoMu !== undefined) data.demoMu = patch.demoMu
  if (patch.demoBitisTarihi !== undefined) data.demoBitisTarihi = patch.demoBitisTarihi
  if (patch.sonOdemeTarihi !== undefined) data.sonOdemeTarihi = patch.sonOdemeTarihi
  if (patch.yillikUcret !== undefined) data.yillikUcret = patch.yillikUcret == null ? null : patch.yillikUcret
  if (patch.lisansNotlari !== undefined) data.lisansNotlari = patch.lisansNotlari

  const meta = getRequestMeta(req)
  const updated = await prisma.tenant.update({ where: { id }, data })

  await writeAdminAuditLog({
    adminId,
    action: 'TENANT_UPDATED',
    entityType: 'Tenant',
    entityId: id,
    oldValue: existing as unknown as Prisma.InputJsonValue,
    newValue: updated as unknown as Prisma.InputJsonValue,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return updated
}

function dayStart(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Uzatma tabanı: bitiş takvim günü bugün veya sonrasıysa mevcut bitişten; aksi halde bugünün başı. */
function computeExtensionBaseDate(tenant: Tenant): Date {
  const today = dayStart(new Date())
  const end = tenant.lisansBitisTarihi
  if (!end) return today
  const endDay = dayStart(end)
  if (endDay.getTime() >= today.getTime()) return new Date(end)
  return today
}

function addFromBase(base: Date, miktar: number, birim: 'GUN' | 'AY' | 'YIL'): Date {
  const next = new Date(base)
  if (birim === 'GUN') next.setDate(next.getDate() + miktar)
  else if (birim === 'AY') next.setMonth(next.getMonth() + miktar)
  else next.setFullYear(next.getFullYear() + miktar)
  return next
}

export async function adminExtendTenantLicense(
  id: string,
  body: ExtendBody,
  adminId: string,
  req: Request
): Promise<Tenant> {
  const t = await prisma.tenant.findUnique({ where: { id } })
  if (!t) throw new AppError(404, 'Büro bulunamadı.', 'NOT_FOUND')

  let next: Date
  let auditBirim: 'GUN' | 'AY' | 'YIL' | null = null
  let auditMiktar: number | null = null

  if (body.bitisTarihi != null) {
    next = new Date(body.bitisTarihi)
    const bisDay = dayStart(next)
    const today = dayStart(new Date())
    if (bisDay.getTime() < today.getTime()) {
      throw new AppError(400, 'Bitiş tarihi bugünden önce olamaz.', 'VALIDATION')
    }
  } else if (body.miktar != null && body.birim != null) {
    const base = computeExtensionBaseDate(t)
    next = addFromBase(base, body.miktar, body.birim)
    auditBirim = body.birim
    auditMiktar = body.miktar
  } else if (body.aySayisi != null || body.yilSayisi != null) {
    const base = computeExtensionBaseDate(t)
    next = new Date(base)
    if (body.aySayisi != null) next.setMonth(next.getMonth() + body.aySayisi)
    if (body.yilSayisi != null) next.setFullYear(next.getFullYear() + body.yilSayisi)
    if (body.yilSayisi != null) {
      auditBirim = 'YIL'
      auditMiktar = body.yilSayisi
    } else {
      auditBirim = 'AY'
      auditMiktar = body.aySayisi!
    }
  } else {
    throw new AppError(400, 'Geçersiz uzatma gövdesi.', 'VALIDATION')
  }

  const isDemo = body.demoMu === true
  const meta = getRequestMeta(req)
  const noteAppend = body.aciklama?.trim()

  const oldLisansBas = t.lisansBaslangicTarihi?.toISOString() ?? null
  const oldLisansBitis = t.lisansBitisTarihi?.toISOString() ?? null
  const oldDemoBitis = t.demoBitisTarihi?.toISOString() ?? null

  const updated = await prisma.tenant.update({
    where: { id },
    data: {
      ...(t.lisansBaslangicTarihi == null ? { lisansBaslangicTarihi: new Date() } : {}),
      lisansBitisTarihi: next,
      lisansDurumu: isDemo ? 'DEMO' : 'AKTIF',
      demoMu: isDemo,
      demoBitisTarihi: isDemo ? next : null,
      ...(noteAppend
        ? {
            lisansNotlari: [t.lisansNotlari, noteAppend].filter(Boolean).join('\n')
          }
        : {})
    }
  })

  await writeAdminAuditLog({
    adminId,
    action: 'TENANT_LICENSE_EXTENDED',
    entityType: 'Tenant',
    entityId: id,
    oldValue: {
      lisansBaslangicTarihi: oldLisansBas,
      lisansBitisTarihi: oldLisansBitis,
      demoBitisTarihi: oldDemoBitis,
      lisansDurumu: t.lisansDurumu,
      demoMu: t.demoMu
    } as unknown as Prisma.InputJsonValue,
    newValue: {
      lisansBaslangicTarihi: updated.lisansBaslangicTarihi?.toISOString() ?? null,
      lisansBitisTarihi: next.toISOString(),
      demoBitisTarihi: isDemo ? next.toISOString() : null,
      lisansDurumu: isDemo ? 'DEMO' : 'AKTIF',
      demoMu: isDemo,
      birim: auditBirim,
      miktar: auditMiktar,
      bitisTarihiMode: body.bitisTarihi != null,
      demoMuBody: body.demoMu ?? false,
      aciklama: body.aciklama ?? null
    } as unknown as Prisma.InputJsonValue,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return updated
}

export async function adminSetTenantActive(id: string, aktif: boolean, adminId: string, req: Request): Promise<Tenant> {
  const t = await prisma.tenant.findUnique({ where: { id } })
  if (!t) throw new AppError(404, 'Büro bulunamadı.', 'NOT_FOUND')
  const meta = getRequestMeta(req)
  const updated = await prisma.tenant.update({ where: { id }, data: { aktifMi: aktif } })
  await writeAdminAuditLog({
    adminId,
    action: aktif ? 'TENANT_ACTIVATED' : 'TENANT_DEACTIVATED',
    entityType: 'Tenant',
    entityId: id,
    oldValue: { aktifMi: t.aktifMi },
    newValue: { aktifMi: aktif },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })
  return updated
}

export async function adminListTenantUsers(tenantId: string) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!t) throw new AppError(404, 'Büro bulunamadı.', 'NOT_FOUND')
  return prisma.user.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      tenantId: true,
      adSoyad: true,
      kullaniciAdi: true,
      eposta: true,
      telefon: true,
      role: true,
      aktifMi: true,
      sonGirisTarihi: true,
      createdAt: true
    }
  })
}

export async function adminUpdateUser(
  userId: string,
  body: UserUpdateBody,
  adminId: string,
  req: Request
) {
  const u = await prisma.user.findFirst({ where: { id: userId, tenantId: body.tenantId } })
  if (!u) throw new AppError(404, 'Kullanıcı bulunamadı.', 'NOT_FOUND')

  const data: Prisma.UserUpdateInput = {}
  if (body.adSoyad !== undefined) data.adSoyad = body.adSoyad
  if (body.eposta !== undefined) data.eposta = body.eposta
  if (body.telefon !== undefined) data.telefon = body.telefon
  if (body.rol !== undefined) data.role = body.rol
  if (body.aktifMi !== undefined) data.aktifMi = body.aktifMi

  const meta = getRequestMeta(req)
  const updated = await prisma.user.update({ where: { id: userId }, data })
  const { sifreHash: _h, ...publicUser } = updated

  await writeAdminAuditLog({
    adminId,
    action: 'USER_UPDATED_BY_ADMIN',
    entityType: 'User',
    entityId: userId,
    oldValue: {
      id: u.id,
      adSoyad: u.adSoyad,
      eposta: u.eposta,
      telefon: u.telefon,
      role: u.role,
      aktifMi: u.aktifMi
    } as unknown as Prisma.InputJsonValue,
    newValue: {
      id: publicUser.id,
      adSoyad: publicUser.adSoyad,
      eposta: publicUser.eposta,
      telefon: publicUser.telefon,
      role: publicUser.role,
      aktifMi: publicUser.aktifMi
    } as unknown as Prisma.InputJsonValue,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return publicUser
}

export async function adminResetUserPassword(
  userId: string,
  tenantId: string,
  plain: string | undefined,
  adminId: string,
  req: Request
): Promise<{ geciciSifre: string }> {
  const u = await prisma.user.findFirst({ where: { id: userId, tenantId } })
  if (!u) throw new AppError(404, 'Kullanıcı bulunamadı.', 'NOT_FOUND')

  const geciciSifre = plain?.trim() || crypto.randomBytes(12).toString('base64url').slice(0, 16)
  const sifreHash = await hashPassword(geciciSifre)
  const meta = getRequestMeta(req)
  await prisma.user.update({ where: { id: userId }, data: { sifreHash } })

  await writeAdminAuditLog({
    adminId,
    action: 'USER_PASSWORD_RESET_BY_ADMIN',
    entityType: 'User',
    entityId: userId,
    newValue: { resetAt: new Date().toISOString() },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return { geciciSifre }
}

function startOfTodayUtc(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function addDaysUtc(d: Date, days: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

/** Önümüzde N gün içinde lisansı bitecek aktif bürolar (AKTIF/DEMO). */
export async function adminListExpiringTenants(days: number) {
  const today = startOfTodayUtc()
  const until = addDaysUtc(today, Math.min(Math.max(1, days), 365))
  const now = new Date()
  const rows = await prisma.tenant.findMany({
    where: {
      aktifMi: true,
      lisansDurumu: { in: ['AKTIF', 'DEMO'] },
      lisansBitisTarihi: { lte: until, gte: now }
    },
    orderBy: { lisansBitisTarihi: 'asc' },
    take: 500,
    select: {
      id: true,
      buroAdi: true,
      slug: true,
      eposta: true,
      telefon: true,
      lisansDurumu: true,
      lisansBitisTarihi: true,
      yillikUcret: true,
      aktifMi: true
    }
  })

  return rows.map((t) => {
    const end = t.lisansBitisTarihi
    const kalanGun =
      end != null ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000)) : null
    return {
      id: t.id,
      buroAdi: t.buroAdi,
      slug: t.slug,
      eposta: t.eposta,
      telefon: t.telefon,
      lisansDurumu: t.lisansDurumu,
      lisansBitisTarihi: end?.toISOString() ?? null,
      yillikUcret: t.yillikUcret == null ? null : t.yillikUcret.toFixed(2),
      aktifMi: t.aktifMi,
      kalanGun
    }
  })
}

async function ensureUniqueTenantSlug(buroAdi: string): Promise<string> {
  const base = slugifyBuroAdi(buroAdi) || 'buro'
  let slug = base
  let n = 0
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    n += 1
    slug = `${base}-${n}`
  }
  return slug
}

function strOrNull(s: string | undefined): string | null {
  const t = s?.trim()
  return t ? t : null
}

export async function adminCreateTenantWithOwner(
  body: AdminCreateTenantBody,
  adminId: string,
  req: Request
): Promise<{ tenant: ReturnType<typeof serializeTenant>; ownerUser: ReturnType<typeof serializeUser>; geciciSifre: string }> {
  const ownerLower = body.ownerKullaniciAdi
  const taken = await prisma.user.findFirst({
    where: { kullaniciAdi: { equals: ownerLower, mode: 'insensitive' } }
  })
  if (taken) throw new AppError(409, 'Bu kullanıcı adı zaten kullanılıyor.', 'USERNAME_TAKEN')

  const slug = await ensureUniqueTenantSlug(body.buroAdi)
  const baslangic = new Date()
  const bitis = addFromBase(new Date(baslangic.getTime()), body.lisansSuresiMiktar, body.lisansSuresiBirim)
  const demo = body.lisansTipi === 'DEMO'
  const meta = getRequestMeta(req)

  const tenantEposta = strOrNull(body.eposta)?.toLowerCase() ?? null
  const ownerEposta = strOrNull(body.ownerEposta)?.toLowerCase() ?? null
  const plainPassword = body.ownerSifre
  const sifreHash = await hashPassword(plainPassword)
  const notlar = strOrNull(body.notlar)

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          buroAdi: body.buroAdi.trim(),
          slug,
          telefon: strOrNull(body.telefon),
          eposta: tenantEposta,
          adres: strOrNull(body.adres),
          vergiNo: strOrNull(body.vergiNo),
          vergiDairesi: strOrNull(body.vergiDairesi),
          aktifMi: true,
          lisansBaslangicTarihi: baslangic,
          lisansBitisTarihi: bitis,
          lisansDurumu: demo ? 'DEMO' : 'AKTIF',
          demoMu: demo,
          demoBitisTarihi: demo ? bitis : null,
          yillikUcret: body.yillikUcret != null ? new Prisma.Decimal(body.yillikUcret) : null,
          lisansNotlari: notlar
        }
      })

      const ownerUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          adSoyad: body.ownerAdSoyad.trim(),
          kullaniciAdi: ownerLower,
          eposta: ownerEposta,
          telefon: strOrNull(body.ownerTelefon),
          sifreHash,
          role: 'BURO_SAHIBI',
          aktifMi: true
        }
      })

      return { tenant, ownerUser }
    })

    await writeAdminAuditLog({
      adminId,
      action: 'TENANT_CREATED_BY_ADMIN',
      entityType: 'Tenant',
      entityId: result.tenant.id,
      newValue: {
        tenantId: result.tenant.id,
        buroAdi: result.tenant.buroAdi,
        ownerUserId: result.ownerUser.id,
        lisansDurumu: result.tenant.lisansDurumu,
        lisansBitisTarihi: result.tenant.lisansBitisTarihi?.toISOString() ?? null,
        adminId
      } as unknown as Prisma.InputJsonValue,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })

    await writeAuditLog({
      tenantId: result.tenant.id,
      userId: null,
      action: 'OFFICE_CREATED_BY_ADMIN',
      entityType: 'Tenant',
      entityId: result.tenant.id,
      newValue: { slug: result.tenant.slug, adminId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })

    await writeAuditLog({
      tenantId: result.tenant.id,
      userId: result.ownerUser.id,
      action: 'USER_CREATED_BY_ADMIN',
      entityType: 'User',
      entityId: result.ownerUser.id,
      newValue: { kullaniciAdi: result.ownerUser.kullaniciAdi, adminId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })

    return {
      tenant: serializeTenant(result.tenant),
      ownerUser: serializeUser(result.ownerUser),
      geciciSifre: plainPassword
    }
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: string }).code) : ''
    if (code === 'P2002') {
      throw new AppError(409, 'Büro veya kullanıcı bilgisi çakışıyor (ör. kullanıcı adı veya e-posta).', 'DUPLICATE')
    }
    throw e
  }
}
