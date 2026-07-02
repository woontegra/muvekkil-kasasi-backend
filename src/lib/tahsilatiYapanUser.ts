import type { UserRole } from '@prisma/client'
import { prisma } from './prisma.js'
import { AppError } from '../middleware/errorHandler.js'

const YONETICI_ROLLER: UserRole[] = ['BURO_SAHIBI', 'AVUKAT_YONETICI']

export async function resolveTahsilatiYapanUserId(
  tenantId: string,
  actorUserId: string,
  actorRole: UserRole,
  requestedUserId?: string | null
): Promise<string> {
  const targetId = requestedUserId?.trim() || actorUserId
  if (targetId === actorUserId) return actorUserId

  if (!YONETICI_ROLLER.includes(actorRole)) {
    throw new AppError(403, 'Tahsilatı yapan personel yalnızca yönetici tarafından değiştirilebilir.', 'FORBIDDEN')
  }

  const user = await prisma.user.findFirst({
    where: { id: targetId, tenantId, aktifMi: true },
    select: { id: true }
  })
  if (!user) {
    throw new AppError(400, 'Geçersiz personel seçimi.', 'INVALID_USER')
  }
  return user.id
}
