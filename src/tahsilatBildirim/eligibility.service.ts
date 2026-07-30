import { BildirimIsDurumu, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

/** İptal nedenleri — ayar kapatılırken PLANLANDI/KUYRUKTA işlere yazılır. */
export const BILDIRIM_IPTAL_NEDENI = {
  MUVEKKIL: 'Müvekkil otomatik bildirim iznini kapattı',
  DOSYA: 'Dosya için otomasyon kapatıldı',
  TAKSIT: 'Taksit için otomasyon kapatıldı'
} as const

/** Kullanıcıya gösterilen uygunluk / atlama metinleri (teknik enum yok). */
export const BILDIRIM_UYGUNLUK_MESAJI = {
  TENANT_KAPALI: 'Büro otomasyonu kapalı',
  MUVEKKIL_KAPALI: 'Müvekkil için otomatik mesaj kapalı',
  DOSYA_KAPALI: 'Bu dosyada hatırlatmalar kapalı',
  TAKSIT_KAPALI: 'Bu taksit sessize alınmış',
  UYGUN: 'Otomatik hatırlatmaya uygun'
} as const

export type BildirimEngellemeSeviyesi = 'NONE' | 'TENANT' | 'MUVEKKIL' | 'DOSYA' | 'TAKSIT'

export type BildirimEligibilityInput = {
  tenantOtomasyonAktif: boolean
  muvekkilIzni: boolean
  dosyaAktif: boolean
  /** Varsayılan açık (true). */
  taksitAktif: boolean
}

export type BildirimEligibilityResult = {
  eligible: boolean
  blockingLevel: BildirimEngellemeSeviyesi
  /** Liste / UI için kullanıcı dostu metin */
  kullaniciMesaji: string
  /** Gelecek işleri iptal ederken kullanılacak neden (yalnızca ayar kapalı seviyeleri) */
  iptalNedeni: string | null
}

/**
 * Tek merkezi karar: üst seviye kapalıysa alt seviye açık olsa bile mesaj yok.
 * Öncelik: tenant → müvekkil → dosya → taksit.
 */
export function evaluateAutoBildirimEligibility(
  input: BildirimEligibilityInput
): BildirimEligibilityResult {
  if (!input.tenantOtomasyonAktif) {
    return {
      eligible: false,
      blockingLevel: 'TENANT',
      kullaniciMesaji: BILDIRIM_UYGUNLUK_MESAJI.TENANT_KAPALI,
      iptalNedeni: null
    }
  }
  if (!input.muvekkilIzni) {
    return {
      eligible: false,
      blockingLevel: 'MUVEKKIL',
      kullaniciMesaji: BILDIRIM_UYGUNLUK_MESAJI.MUVEKKIL_KAPALI,
      iptalNedeni: BILDIRIM_IPTAL_NEDENI.MUVEKKIL
    }
  }
  if (!input.dosyaAktif) {
    return {
      eligible: false,
      blockingLevel: 'DOSYA',
      kullaniciMesaji: BILDIRIM_UYGUNLUK_MESAJI.DOSYA_KAPALI,
      iptalNedeni: BILDIRIM_IPTAL_NEDENI.DOSYA
    }
  }
  if (!input.taksitAktif) {
    return {
      eligible: false,
      blockingLevel: 'TAKSIT',
      kullaniciMesaji: BILDIRIM_UYGUNLUK_MESAJI.TAKSIT_KAPALI,
      iptalNedeni: BILDIRIM_IPTAL_NEDENI.TAKSIT
    }
  }
  return {
    eligible: true,
    blockingLevel: 'NONE',
    kullaniciMesaji: BILDIRIM_UYGUNLUK_MESAJI.UYGUN,
    iptalNedeni: null
  }
}

/** Eski teknik metinleri kullanıcı dostu metne çevir (liste geriye uyum). */
export function humanizeBildirimNedeni(raw: string | null | undefined): string | null {
  if (raw == null || raw.trim() === '') return null
  const t = raw.trim()
  const map: Record<string, string> = {
    'Bildirim izni kapalı': BILDIRIM_UYGUNLUK_MESAJI.MUVEKKIL_KAPALI,
    'Dosyada otomasyon kapalı': BILDIRIM_UYGUNLUK_MESAJI.DOSYA_KAPALI,
    [BILDIRIM_IPTAL_NEDENI.MUVEKKIL]: BILDIRIM_UYGUNLUK_MESAJI.MUVEKKIL_KAPALI,
    [BILDIRIM_IPTAL_NEDENI.DOSYA]: BILDIRIM_UYGUNLUK_MESAJI.DOSYA_KAPALI,
    [BILDIRIM_IPTAL_NEDENI.TAKSIT]: BILDIRIM_UYGUNLUK_MESAJI.TAKSIT_KAPALI
  }
  return map[t] ?? t
}

export type PendingJobScope = {
  tenantId: string
  muvekkilId?: string
  dosyaId?: string
  taksitId?: string
}

function pendingWhere(scope: PendingJobScope): Prisma.TahsilatBildirimIsiWhereInput {
  return {
    tenantId: scope.tenantId,
    durum: { in: [BildirimIsDurumu.PLANLANDI, BildirimIsDurumu.KUYRUKTA] },
    ...(scope.muvekkilId ? { muvekkilId: scope.muvekkilId } : {}),
    ...(scope.dosyaId ? { dosyaId: scope.dosyaId } : {}),
    ...(scope.taksitId ? { taksitId: scope.taksitId } : {})
  }
}

export async function countPendingBildirimJobs(scope: PendingJobScope): Promise<number> {
  return prisma.tahsilatBildirimIsi.count({ where: pendingWhere(scope) })
}

export async function cancelPendingBildirimJobs(
  scope: PendingJobScope,
  iptalNedeni: string
): Promise<number> {
  const result = await prisma.tahsilatBildirimIsi.updateMany({
    where: pendingWhere(scope),
    data: {
      durum: BildirimIsDurumu.IPTAL_EDILDI,
      iptalNedeni,
      lockedAt: null,
      lockedBy: null
    }
  })
  return result.count
}
