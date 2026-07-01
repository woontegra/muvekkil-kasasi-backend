import { Prisma, type SuperAdminRole, type Tenant } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
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
import { normalizeKullaniciAdi, isValidKullaniciAdi } from '../lib/normalizeKullaniciAdi.js'
import {
  provisionTenantWithOwner
} from '../tenant/provisionTenantWithOwner.js'
import { extendTenantLicense } from '../tenant/extendTenantLicense.js'
import { effectiveLicenseEnd } from '../tenant/tenantLicense.js'
import { issueActivationToken } from '../auth/passwordReset.service.js'
import { sendWelcomeActivationEmail } from '../mail/mail.service.js'
import { getActivationTokenExpiresHours } from '../config/env.js'

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

function kalanGunForTenant(t: {
  lisansDurumu: Tenant['lisansDurumu']
  lisansBitisTarihi: Date | null
  demoMu: boolean
  demoBitisTarihi: Date | null
}): number | null {
  const end = effectiveLicenseEnd(t as Tenant)
  if (!end) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endDay = new Date(end)
  endDay.setHours(0, 0, 0, 0)
  return Math.round((endDay.getTime() - today.getTime()) / 86_400_000)
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
      { eposta: { contains: q, mode: 'insensitive' } },
      { lisansAnahtari: { contains: q, mode: 'insensitive' } },
      {
        users: {
          some: {
            role: 'BURO_SAHIBI',
            OR: [
              { adSoyad: { contains: q, mode: 'insensitive' } },
              { eposta: { contains: q, mode: 'insensitive' } },
              { kullaniciAdi: { contains: q, mode: 'insensitive' } }
            ]
          }
        }
      }
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
        users: {
          where: { role: 'BURO_SAHIBI' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: {
            adSoyad: true,
            kullaniciAdi: true,
            eposta: true,
            telefon: true
          }
        },
        _count: { select: { users: true, muvekkiller: true, dosyalar: true } }
      }
    })
  ])

  const items = rows.map((t) => {
    const owner = t.users[0] ?? null
    return {
      id: t.id,
      buroAdi: t.buroAdi,
      slug: t.slug,
      eposta: t.eposta ?? owner?.eposta ?? null,
      telefon: t.telefon ?? owner?.telefon ?? null,
      aktifMi: t.aktifMi,
      lisansDurumu: t.lisansDurumu,
      lisansBaslangicTarihi: t.lisansBaslangicTarihi?.toISOString() ?? null,
      lisansBitisTarihi: t.lisansBitisTarihi?.toISOString() ?? null,
      lisansAnahtari: t.lisansAnahtari,
      demoMu: t.demoMu,
      demoBitisTarihi: t.demoBitisTarihi?.toISOString() ?? null,
      sahipAdSoyad: owner?.adSoyad ?? null,
      sahipKullaniciAdi: owner?.kullaniciAdi ?? null,
      kalanGun: kalanGunForTenant(t),
      toplamKullanici: t._count.users,
      toplamMuvekkil: t._count.muvekkiller,
      toplamDosya: t._count.dosyalar,
      createdAt: t.createdAt.toISOString()
    }
  })

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

  const [auditLogs, kasaCount, licenseRenewals] = await Promise.all([
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
    prisma.kasaHareketi.count({ where: { tenantId: id } }),
    prisma.tenantLicenseRenewal.findMany({
      where: { tenantId: id },
      orderBy: { createdAt: 'desc' }
    })
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
      lisansAnahtari: t.lisansAnahtari,
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
    })),
    licenseRenewals: licenseRenewals.map((r) => ({
      id: r.id,
      tarih: r.createdAt.toISOString(),
      kaynak: r.source,
      eskiBitis: r.previousEndDate.toISOString(),
      yeniBitis: r.newEndDate.toISOString(),
      gunSayisi: r.renewalDays,
      tutar: dec(r.amount),
      paraBirimi: r.currency,
      externalOrderId: r.externalOrderId,
      not: r.note
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

  const isDemo = body.demoMu === true
  const meta = getRequestMeta(req)
  const noteAppend = body.aciklama?.trim()

  let auditBirim: 'GUN' | 'AY' | 'YIL' | null = null
  let auditMiktar: number | null = null

  const extendInput: Parameters<typeof extendTenantLicense>[0] = {
    tenantId: id,
    source: 'SUPER_ADMIN',
    externalOrderId: null,
    licenseKey: t.lisansAnahtari,
    demoMu: isDemo,
    note: noteAppend || null,
    appendLicenseNote: noteAppend || null
  }

  if (body.bitisTarihi != null) {
    extendInput.newEndDate = new Date(body.bitisTarihi)
  } else if (body.miktar != null && body.birim != null) {
    extendInput.addDuration = { miktar: body.miktar, birim: body.birim }
    auditBirim = body.birim
    auditMiktar = body.miktar
  } else if (body.yilSayisi != null) {
    extendInput.addDuration = { miktar: body.yilSayisi, birim: 'YIL' }
    auditBirim = 'YIL'
    auditMiktar = body.yilSayisi
  } else if (body.aySayisi != null) {
    extendInput.addDuration = { miktar: body.aySayisi, birim: 'AY' }
    auditBirim = 'AY'
    auditMiktar = body.aySayisi
  } else {
    throw new AppError(400, 'Geçersiz uzatma gövdesi.', 'VALIDATION')
  }

  const oldLisansBas = t.lisansBaslangicTarihi?.toISOString() ?? null
  const oldLisansBitis = t.lisansBitisTarihi?.toISOString() ?? null
  const oldDemoBitis = t.demoBitisTarihi?.toISOString() ?? null

  const result = await extendTenantLicense(extendInput)
  const updated = result.tenant
  const next = result.newEndDate

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
      aciklama: body.aciklama ?? null,
      renewalId: result.renewal.id,
      renewalDays: result.renewalDays
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

function strOrNull(s: string | undefined): string | null {
  const t = s?.trim()
  return t ? t : null
}

function suggestOwnerKullaniciAdi(ownerEposta: string, ownerAdSoyad: string, buroAdi: string): string {
  const fromEmail = ownerEposta.split('@')[0] ?? ''
  let base =
    normalizeKullaniciAdi(fromEmail) || normalizeKullaniciAdi(ownerAdSoyad) || normalizeKullaniciAdi(buroAdi)
  if (!isValidKullaniciAdi(base)) {
    base = base ? `${base}mk` : 'mk-user'
    base = base.slice(0, 64)
    if (!isValidKullaniciAdi(base)) base = `user-${Date.now().toString(36).slice(-6)}`
  }
  return base.slice(0, 64)
}

async function ensureUniqueOwnerUsername(preferred: string): Promise<string> {
  let candidate = preferred
  let n = 0
  while (n < 200) {
    const taken = await prisma.user.findFirst({
      where: { kullaniciAdi: { equals: candidate, mode: 'insensitive' } }
    })
    if (!taken) return candidate
    n += 1
    candidate = `${preferred}-${n}`.slice(0, 64)
  }
  throw new AppError(409, 'Uygun kullanıcı adı üretilemedi.', 'USERNAME_TAKEN')
}

type AdminLicenseWindow = {
  baslangic: Date
  bitis: Date
  lisansDurumu: 'DEMO' | 'AKTIF' | 'PASIF'
  demoMu: boolean
}

function resolveAdminLicenseWindow(body: AdminCreateTenantBody): AdminLicenseWindow {
  const baslangic = body.lisansBaslangicTarihi ? new Date(body.lisansBaslangicTarihi) : new Date()

  if (body.lisansPaketi) {
    let bitis: Date
    if (body.lisansPaketi === 'OZEL') {
      bitis = new Date(body.lisansBitisTarihi!)
      const bisDay = dayStart(bitis)
      const today = dayStart(new Date())
      if (bisDay.getTime() < today.getTime()) {
        throw new AppError(400, 'Bitiş tarihi bugünden önce olamaz.', 'VALIDATION')
      }
    } else {
      const paketMap: Record<
        Exclude<AdminCreateTenantBody['lisansPaketi'], 'OZEL' | undefined>,
        { miktar: number; birim: 'GUN' | 'AY' }
      > = {
        DEMO: { miktar: 14, birim: 'GUN' },
        AYLIK: { miktar: 1, birim: 'AY' },
        UC_AY: { miktar: 3, birim: 'AY' },
        ALTI_AY: { miktar: 6, birim: 'AY' },
        YILLIK: { miktar: 12, birim: 'AY' }
      }
      const spec = paketMap[body.lisansPaketi as keyof typeof paketMap]
      bitis = addFromBase(baslangic, spec.miktar, spec.birim)
    }

    const lisansDurumu = body.lisansDurumu ?? (body.lisansPaketi === 'DEMO' ? 'DEMO' : 'AKTIF')
    const demoMu = body.demoMu ?? (body.lisansPaketi === 'DEMO' || lisansDurumu === 'DEMO')
    return { baslangic, bitis, lisansDurumu, demoMu }
  }

  const demo = body.lisansTipi === 'DEMO'
  const bitis = addFromBase(baslangic, body.lisansSuresiMiktar!, body.lisansSuresiBirim!)
  return {
    baslangic,
    bitis,
    lisansDurumu: demo ? 'DEMO' : 'AKTIF',
    demoMu: demo
  }
}

export async function adminCreateTenantWithOwner(
  body: AdminCreateTenantBody,
  adminId: string,
  req: Request
): Promise<{
  tenant: ReturnType<typeof serializeTenant>
  ownerUser: ReturnType<typeof serializeUser>
  geciciSifre: string | null
  lisansAnahtari: string | null
  mailSent: boolean
  mailError?: string
  aktivasyonMailiGonderildi: boolean
  hosgeldinMailiGonderildi: boolean
}> {
  const ownerEmail = body.ownerEposta.trim().toLowerCase()
  const emailTaken = await prisma.user.findFirst({
    where: { eposta: { equals: ownerEmail, mode: 'insensitive' } }
  })
  if (emailTaken) {
    throw new AppError(409, 'Bu e-posta adresi zaten kayıtlı.', 'EMAIL_TAKEN')
  }

  const usernameHint = body.ownerKullaniciAdi ?? suggestOwnerKullaniciAdi(ownerEmail, body.ownerAdSoyad, body.buroAdi)
  const ownerLower = await ensureUniqueOwnerUsername(usernameHint)

  const license = resolveAdminLicenseWindow(body)
  const meta = getRequestMeta(req)
  const notlar = strOrNull(body.lisansNotlari) ?? strOrNull(body.notlar)

  let plainPassword: string | null = null
  let sifreHash: string
  if (body.parolaModu === 'MANUEL') {
    plainPassword = body.ownerSifre!.trim()
    sifreHash = await hashPassword(plainPassword)
  } else {
    const randomSecret = crypto.randomBytes(32).toString('base64url')
    sifreHash = await hashPassword(randomSecret)
  }

  const tenantAktif = license.lisansDurumu !== 'PASIF'

  const result = await provisionTenantWithOwner(
    {
      buroAdi: body.buroAdi,
      slug: body.slug,
      telefon: body.telefon,
      eposta: body.eposta,
      adres: body.adres,
      vergiNo: body.vergiNo,
      vergiDairesi: body.vergiDairesi,
      aktifMi: tenantAktif,
      lisansBaslangicTarihi: license.baslangic,
      lisansBitisTarihi: license.bitis,
      lisansDurumu: license.lisansDurumu,
      demoMu: license.demoMu,
      demoBitisTarihi: license.demoMu ? license.bitis : null,
      yillikUcret: body.yillikUcret ?? null,
      sonOdemeTarihi: body.sonOdemeTarihi ?? null,
      lisansNotlari: notlar,
      owner: {
        adSoyad: body.ownerAdSoyad,
        kullaniciAdi: ownerLower,
        eposta: ownerEmail,
        telefon: body.ownerTelefon,
        sifreHash
      }
    },
    {
      source: 'ADMIN',
      adminId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    }
  )

  let mailSent = false
  let mailError: string | undefined
  let aktivasyonMailiGonderildi = false
  let hosgeldinMailiGonderildi = false

  const shouldSendMail =
    body.parolaModu === 'AKTIVASYON_MAIL' && (body.gonderAktivasyonMaili || body.gonderHosgeldinMaili)

  if (shouldSendMail) {
    const { plainToken } = await issueActivationToken(result.ownerUser.id)
    const mailResult = await sendWelcomeActivationEmail({
      to: ownerEmail,
      plainToken,
      buroAdi: result.tenant.buroAdi,
      kullaniciAdi: result.ownerUser.kullaniciAdi,
      lisansBaslangic: result.tenant.lisansBaslangicTarihi?.toISOString() ?? license.baslangic.toISOString(),
      lisansBitis: result.tenant.lisansBitisTarihi?.toISOString() ?? license.bitis.toISOString(),
      lisansAnahtari: result.tenant.lisansAnahtari,
      activationExpiresHours: getActivationTokenExpiresHours()
    })
    mailSent = mailResult.sent
    mailError = mailResult.error
    aktivasyonMailiGonderildi = body.gonderAktivasyonMaili && mailResult.sent
    hosgeldinMailiGonderildi = body.gonderHosgeldinMaili && mailResult.sent

    await writeAdminAuditLog({
      adminId,
      action: 'WELCOME_ACTIVATION_EMAIL_ON_CREATE',
      entityType: 'Tenant',
      entityId: result.tenant.id,
      newValue: {
        mailSent: mailResult.sent,
        mailError: mailResult.error ?? null,
        ownerUserId: result.ownerUser.id
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
  }

  return {
    tenant: serializeTenant(result.tenant),
    ownerUser: serializeUser(result.ownerUser),
    geciciSifre: plainPassword,
    lisansAnahtari: result.tenant.lisansAnahtari,
    mailSent,
    ...(mailError ? { mailError } : {}),
    aktivasyonMailiGonderildi,
    hosgeldinMailiGonderildi
  }
}

export async function adminResendWelcomeActivationEmail(
  tenantId: string,
  adminId: string,
  req: Request
): Promise<{ mailSent: boolean; mailError?: string }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) throw new AppError(404, 'Büro bulunamadı.', 'NOT_FOUND')

  const owner = await prisma.user.findFirst({
    where: { tenantId, role: 'BURO_SAHIBI' },
    orderBy: { createdAt: 'asc' }
  })
  if (!owner) throw new AppError(404, 'Büro sahibi bulunamadı.', 'NOT_FOUND')

  const email = owner.eposta?.trim().toLowerCase()
  if (!email) throw new AppError(422, 'Büro sahibinin e-posta adresi yok.', 'VALIDATION_ERROR')

  const { plainToken } = await issueActivationToken(owner.id)
  const result = await sendWelcomeActivationEmail({
    to: email,
    plainToken,
    buroAdi: tenant.buroAdi,
    kullaniciAdi: owner.kullaniciAdi,
    lisansBaslangic: tenant.lisansBaslangicTarihi?.toISOString() ?? new Date().toISOString(),
    lisansBitis: tenant.lisansBitisTarihi?.toISOString() ?? new Date().toISOString(),
    lisansAnahtari: tenant.lisansAnahtari,
    activationExpiresHours: getActivationTokenExpiresHours()
  })

  const meta = getRequestMeta(req)
  await writeAdminAuditLog({
    adminId,
    action: 'WELCOME_ACTIVATION_EMAIL_RESENT',
    entityType: 'Tenant',
    entityId: tenantId,
    newValue: { mailSent: result.sent, mailError: result.error ?? null, ownerUserId: owner.id },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  if (!result.sent) {
    return { mailSent: false, mailError: result.error ?? 'MAIL_SEND_FAILED' }
  }
  return { mailSent: true }
}
