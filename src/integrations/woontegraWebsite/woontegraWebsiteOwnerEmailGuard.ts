import type { Tenant, User } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../middleware/errorHandler.js'
import type { WoontegraWebsiteProvisionBody } from './woontegraWebsiteProvision.schemas.js'

export const OWNER_EMAIL_ALREADY_EXISTS_MESSAGE =
  'Bu e-posta adresiyle daha önce Müvekkil Kasa hesabı oluşturulmuş. Güvenlik nedeniyle otomatik bağlama yapılamaz. Lütfen destek ile iletişime geçin.'

export type OwnerEmailConflictResolution = {
  tenant: Tenant
  owner: User
}

/**
 * Owner e-postası zaten kayıtlıysa idempotent tenant döndürür veya güvenlik hatası fırlatır.
 * Farklı tenant / müşteri için otomatik bağlama yapılmaz.
 */
export async function resolveOwnerEmailConflict(
  body: WoontegraWebsiteProvisionBody,
): Promise<OwnerEmailConflictResolution | null> {
  const ownerEmail = body.customer.email.trim().toLowerCase()
  const existingUser = await prisma.user.findFirst({
    where: { eposta: { equals: ownerEmail, mode: 'insensitive' } },
    include: { tenant: true },
    orderBy: { createdAt: 'asc' },
  })

  if (!existingUser) return null

  if (!existingUser.tenant) {
    throw new AppError(409, OWNER_EMAIL_ALREADY_EXISTS_MESSAGE, 'OWNER_EMAIL_ALREADY_EXISTS')
  }

  const tenant = existingUser.tenant
  const extOrder = body.externalOrderId
  const extCustomer = body.externalCustomerId?.trim() ?? null

  if (tenant.externalOrderId === extOrder) {
    return { tenant, owner: existingUser }
  }
  if (extCustomer && tenant.externalCustomerId === extCustomer) {
    return { tenant, owner: existingUser }
  }

  throw new AppError(409, OWNER_EMAIL_ALREADY_EXISTS_MESSAGE, 'OWNER_EMAIL_ALREADY_EXISTS')
}
