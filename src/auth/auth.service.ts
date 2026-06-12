import bcrypt from 'bcrypt'
import type { Tenant, User } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { slugifyBuroAdi } from '../lib/slug.js'
import { writeAuditLog } from '../audit/auditService.js'
import { signAccessToken } from './jwt.js'
import type { RegisterOfficeBody, LoginBody } from './auth.schemas.js'
import { AppError } from '../middleware/errorHandler.js'
import type { Request } from 'express'
import { getRequestMeta } from './requestMeta.js'

const BCRYPT_ROUNDS = 12

export type PublicUser = Omit<User, 'sifreHash'>
export type PublicTenant = Tenant

export function serializeUser(u: User & { tenant?: Tenant }): PublicUser {
  const { sifreHash: _, tenant: __, ...rest } = u
  return rest as PublicUser
}

export function serializeTenant(t: Tenant): PublicTenant {
  return t
}

export type AuthSuccessPayload = {
  accessToken: string
  user: PublicUser
  tenant: PublicTenant
}

async function ensureUniqueSlug(base: string): Promise<string> {
  let slug = base
  let n = 0
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    n += 1
    slug = `${base}-${n}`
  }
  return slug
}

export async function registerOffice(body: RegisterOfficeBody, req: Request): Promise<AuthSuccessPayload> {
  const meta = getRequestMeta(req)
  const slugBase = slugifyBuroAdi(body.buroAdi)
  const slug = await ensureUniqueSlug(slugBase)
  const sifreHash = await bcrypt.hash(body.sifre, BCRYPT_ROUNDS)

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          buroAdi: body.buroAdi.trim(),
          slug,
          telefon: body.telefon.trim(),
          eposta: body.eposta.trim().toLowerCase(),
          aktifMi: true
        }
      })
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          adSoyad: body.adSoyad.trim(),
          kullaniciAdi: body.kullaniciAdi,
          eposta: body.eposta.trim().toLowerCase(),
          telefon: body.telefon.trim(),
          sifreHash,
          role: 'BURO_SAHIBI',
          aktifMi: true
        }
      })
      return { tenant, user }
    })

    await writeAuditLog({
      tenantId: result.tenant.id,
      userId: result.user.id,
      action: 'AUTH_REGISTER_OFFICE',
      entityType: 'Tenant',
      entityId: result.tenant.id,
      newValue: { buroAdi: result.tenant.buroAdi, slug: result.tenant.slug },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })

    const accessToken = signAccessToken({
      userId: result.user.id,
      tenantId: result.tenant.id,
      role: result.user.role,
      kullaniciAdi: result.user.kullaniciAdi
    })

    return {
      accessToken,
      user: serializeUser(result.user),
      tenant: serializeTenant(result.tenant)
    }
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: string }).code) : ''
    if (code === 'P2002') {
      throw new AppError(409, 'Bu e-posta veya kullanıcı adı zaten kayıtlı.', 'DUPLICATE')
    }
    throw e
  }
}

export async function login(body: LoginBody, req: Request): Promise<AuthSuccessPayload> {
  const meta = getRequestMeta(req)
  const raw = body.epostaVeyaKullaniciAdi.trim()
  const isEmail = raw.includes('@')

  let user: (User & { tenant: Tenant }) | null = null

  if (isEmail) {
    const email = raw.toLowerCase()
    const matches = await prisma.user.findMany({
      where: {
        eposta: { equals: email, mode: 'insensitive' },
        aktifMi: true,
        tenant: { aktifMi: true }
      },
      include: { tenant: true }
    })
    if (matches.length === 0) {
      await writeAuditLog({
        tenantId: null,
        userId: null,
        action: 'AUTH_LOGIN_FAILED',
        meta: { reason: 'USER_NOT_FOUND', identifier: email },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      })
      throw new AppError(401, 'Kullanıcı adı/e-posta veya şifre hatalı.', 'INVALID_CREDENTIALS')
    }
    if (matches.length > 1) {
      await writeAuditLog({
        tenantId: null,
        userId: null,
        action: 'AUTH_LOGIN_FAILED',
        meta: { reason: 'AMBIGUOUS_EMAIL', identifier: email },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      })
      throw new AppError(
        400,
        'Bu e-posta birden fazla büroda kayıtlı. Lütfen kullanıcı adı + büro kodu ile giriş yapın.',
        'AMBIGUOUS_EMAIL'
      )
    }
    user = matches[0]!
  } else {
    const slug = body.tenantSlug!.trim().toLowerCase()
    const tenant = await prisma.tenant.findUnique({ where: { slug } })
    if (!tenant || !tenant.aktifMi) {
      await writeAuditLog({
        tenantId: null,
        userId: null,
        action: 'AUTH_LOGIN_FAILED',
        meta: { reason: 'TENANT_NOT_FOUND', slug },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      })
      throw new AppError(401, 'Kullanıcı adı/e-posta veya şifre hatalı.', 'INVALID_CREDENTIALS')
    }
    user = await prisma.user.findFirst({
      where: {
        tenantId: tenant.id,
        kullaniciAdi: { equals: raw, mode: 'insensitive' },
        aktifMi: true
      },
      include: { tenant: true }
    })
    if (!user || !user.tenant.aktifMi) {
      await writeAuditLog({
        tenantId: tenant.id,
        userId: null,
        action: 'AUTH_LOGIN_FAILED',
        meta: { reason: 'USER_NOT_FOUND', kullaniciAdi: raw },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      })
      throw new AppError(401, 'Kullanıcı adı/e-posta veya şifre hatalı.', 'INVALID_CREDENTIALS')
    }
  }

  const ok = await bcrypt.compare(body.sifre, user.sifreHash)
  if (!ok) {
    await writeAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'AUTH_LOGIN_FAILED',
      meta: { reason: 'BAD_PASSWORD' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })
    throw new AppError(401, 'Kullanıcı adı/e-posta veya şifre hatalı.', 'INVALID_CREDENTIALS')
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { sonGirisTarihi: new Date() },
    include: { tenant: true }
  })

  await writeAuditLog({
    tenantId: updated.tenantId,
    userId: updated.id,
    action: 'AUTH_LOGIN_SUCCESS',
    entityType: 'User',
    entityId: updated.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  const accessToken = signAccessToken({
    userId: updated.id,
    tenantId: updated.tenant.id,
    role: updated.role,
    kullaniciAdi: updated.kullaniciAdi
  })

  return {
    accessToken,
    user: serializeUser(updated),
    tenant: serializeTenant(updated.tenant)
  }
}

export async function loadUserWithTenant(userId: string, tenantId: string): Promise<(User & { tenant: Tenant }) | null> {
  return prisma.user.findFirst({
    where: { id: userId, tenantId, aktifMi: true, tenant: { aktifMi: true } },
    include: { tenant: true }
  })
}
