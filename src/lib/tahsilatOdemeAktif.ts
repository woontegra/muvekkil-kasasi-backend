/**
 * Tahsilat ödemesi aktif mi?
 * Ofis Kasası soft-delete ile iptal edilen bağlı gelir → ödeme bakiyeden düşer; satır/makbuz korunur.
 */
import type { Prisma } from '@prisma/client'

export function isTahsilatOdemeAktif(odeme: {
  iptalAt?: Date | null
  ofisKasaHareketId?: string | null
  ofisKasaHareket?: { deletedAt: Date | null } | null
}): boolean {
  if (odeme.iptalAt != null) return false
  if (!odeme.ofisKasaHareketId) return true
  if (!odeme.ofisKasaHareket) return false
  return odeme.ofisKasaHareket.deletedAt == null
}

export function filterAktifTahsilatOdemeleri<
  T extends {
    iptalAt?: Date | null
    ofisKasaHareketId?: string | null
    ofisKasaHareket?: { deletedAt: Date | null } | null
  }
>(odemeler: T[]): T[] {
  return odemeler.filter(isTahsilatOdemeAktif)
}

/** Prisma where: iptalAt null + bağlı ofis soft-delete değil (veya ofis bağı yok). */
export function aktifTahsilatOdemeWhere(): Pick<
  Prisma.VekaletTaksitOdemeWhereInput,
  'iptalAt' | 'OR'
> {
  return {
    iptalAt: null,
    OR: [{ ofisKasaHareketId: null }, { ofisKasaHareket: { is: { deletedAt: null } } }]
  }
}
