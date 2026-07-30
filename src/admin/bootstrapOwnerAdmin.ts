import bcrypt from 'bcrypt'
import type { PrismaClient, SuperAdmin } from '@prisma/client'

const BCRYPT_COST = 12

export type BootstrapOwnerAdminInput = {
  email: string
  password: string
  adSoyad: string
  /** Unique username; defaults derived from email local-part. */
  kullaniciAdi?: string
}

export type BootstrapOwnerAdminResult = {
  adminId: string
  email: string
  created: boolean
  updated: boolean
  deactivatedOtherCount: number
  revokedSessionCount: number
  aktifAdminCount: number
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

function deriveUsername(email: string, override?: string): string {
  const fromEnv = override?.trim()
  if (fromEnv) return fromEnv
  const local = email.split('@')[0]?.replace(/[^a-z0-9._-]/gi, '') || 'woontegra'
  return local.slice(0, 48) || 'woontegra.owner'
}

/**
 * Idempotent: tek aktif SUPER_ADMIN (verilen e-posta).
 * Düz parola saklanmaz / loglanmaz.
 */
export async function bootstrapOwnerAdmin(
  prisma: PrismaClient,
  input: BootstrapOwnerAdminInput
): Promise<BootstrapOwnerAdminResult> {
  const email = normalizeEmail(input.email)
  if (!email || !email.includes('@')) {
    throw new Error('Geçerli ADMIN_BOOTSTRAP_EMAIL gerekli.')
  }
  const password = input.password
  if (!password || password.length < 10) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD en az 10 karakter olmalı.')
  }
  const adSoyad = input.adSoyad.trim() || 'Woontegra Süper Admin'
  const sifreHash = await bcrypt.hash(password, BCRYPT_COST)

  return prisma.$transaction(async (tx) => {
    const existingByEmail = await tx.superAdmin.findFirst({
      where: { eposta: { equals: email, mode: 'insensitive' } }
    })

    let admin: SuperAdmin
    let created = false
    let updated = false

    if (existingByEmail) {
      admin = await tx.superAdmin.update({
        where: { id: existingByEmail.id },
        data: {
          eposta: email,
          adSoyad,
          rol: 'SUPER_ADMIN',
          aktifMi: true,
          sifreHash
        }
      })
      updated = true
    } else {
      let kullaniciAdi = deriveUsername(email, input.kullaniciAdi)
      const usernameTaken = await tx.superAdmin.findUnique({ where: { kullaniciAdi } })
      if (usernameTaken) {
        kullaniciAdi = `${kullaniciAdi}.owner`.slice(0, 48)
      }
      const stillTaken = await tx.superAdmin.findUnique({ where: { kullaniciAdi } })
      if (stillTaken) {
        kullaniciAdi = `wtg_${Date.now().toString(36)}`.slice(0, 48)
      }
      admin = await tx.superAdmin.create({
        data: {
          adSoyad,
          kullaniciAdi,
          eposta: email,
          sifreHash,
          rol: 'SUPER_ADMIN',
          aktifMi: true
        }
      })
      created = true
    }

    const others = await tx.superAdmin.findMany({
      where: { aktifMi: true, NOT: { id: admin.id } },
      select: { id: true }
    })
    const otherIds = others.map((o) => o.id)

    if (otherIds.length > 0) {
      await tx.superAdmin.updateMany({
        where: { id: { in: otherIds } },
        data: { aktifMi: false }
      })
    }

    const now = new Date()
    const revokeResult = await tx.adminRefreshSession.updateMany({
      where: {
        revokedAt: null,
        adminId: { in: [admin.id, ...otherIds] }
      },
      data: { revokedAt: now }
    })

    await tx.adminAuditLog.create({
      data: {
        adminId: admin.id,
        action: 'ADMIN_OWNER_BOOTSTRAP',
        entityType: 'SuperAdmin',
        entityId: admin.id,
        newValue: {
          email,
          created,
          updated,
          deactivatedOtherCount: otherIds.length,
          revokedSessionCount: revokeResult.count,
          role: 'SUPER_ADMIN',
          aktifMi: true
        }
      }
    })

    const aktif = await tx.superAdmin.findMany({
      where: { aktifMi: true },
      select: { id: true, eposta: true, rol: true }
    })
    if (aktif.length !== 1 || aktif[0]?.id !== admin.id) {
      throw new Error('Doğrulama başarısız: tek aktif SuperAdmin bekleniyordu.')
    }
    const aktifEmail = (aktif[0].eposta ?? '').trim().toLowerCase()
    if (aktifEmail !== email) {
      throw new Error('Doğrulama başarısız: aktif admin e-postası hedefle eşleşmiyor.')
    }
    if (aktif[0].rol !== 'SUPER_ADMIN') {
      throw new Error('Doğrulama başarısız: aktif admin SUPER_ADMIN değil.')
    }

    return {
      adminId: admin.id,
      email,
      created,
      updated,
      deactivatedOtherCount: otherIds.length,
      revokedSessionCount: revokeResult.count,
      aktifAdminCount: aktif.length
    }
  })
}

export { BCRYPT_COST, normalizeEmail }
