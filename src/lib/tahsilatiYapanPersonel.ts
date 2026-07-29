import type { UserRole } from '@prisma/client'
import { prisma } from './prisma.js'
import { AppError } from '../middleware/errorHandler.js'

const YONETICI_ROLLER: UserRole[] = ['BURO_SAHIBI', 'AVUKAT_YONETICI']

export type ResolvedTahsilatPersonel = {
  personelId: string | null
  bagliUserId: string | null
}

export async function resolveTahsilatiYapanPersonel(
  tenantId: string,
  actorUserId: string,
  actorRole: UserRole,
  requestedPersonelId?: string | null
): Promise<ResolvedTahsilatPersonel> {
  const yonetici = YONETICI_ROLLER.includes(actorRole)

  const linked = await prisma.primPersonel.findFirst({
    where: { tenantId, bagliUserId: actorUserId, aktifMi: true },
    select: { id: true, bagliUserId: true }
  })

  const targetId = requestedPersonelId?.trim() || linked?.id

  if (!targetId) {
    // Seçim / bağlı personel yoksa giriş yapan kullanıcı kaydedilir.
    return { personelId: null, bagliUserId: actorUserId }
  }

  if (!yonetici && linked?.id !== targetId) {
    throw new AppError(403, 'Tahsilatı yapan personel yalnızca yönetici tarafından değiştirilebilir.', 'FORBIDDEN')
  }

  const personel = await prisma.primPersonel.findFirst({
    where: { id: targetId, tenantId, aktifMi: true },
    select: { id: true, bagliUserId: true }
  })
  if (!personel) {
    throw new AppError(400, 'Geçersiz veya pasif personel seçimi.', 'INVALID_PERSONEL')
  }

  return { personelId: personel.id, bagliUserId: personel.bagliUserId }
}
