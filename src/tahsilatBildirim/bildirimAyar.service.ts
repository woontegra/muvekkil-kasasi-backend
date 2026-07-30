import type { Request } from 'express'
import { prisma } from '../lib/prisma.js'
import { writeAuditLog } from '../audit/auditService.js'
import { AppError } from '../middleware/errorHandler.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { planJobsForTenant } from './planner.service.js'
import {
  BILDIRIM_IPTAL_NEDENI,
  cancelPendingBildirimJobs,
  countPendingBildirimJobs,
  evaluateAutoBildirimEligibility
} from './eligibility.service.js'
import {
  getTaksitOtomatikBildirimAktif,
  setTaksitOtomatikBildirimAktif
} from './taksitBildirimColumn.js'

export type BildirimAyarToggleResult = {
  aktif: boolean
  iptalEdilenSayisi: number
  planlananYeniden: number
  pendingOnceki: number
}

async function loadTenantOtomasyon(tenantId: string): Promise<boolean> {
  const ayar = await prisma.tahsilatBildirimAyar.findUnique({
    where: { tenantId },
    select: { otomasyonAktif: true }
  })
  return ayar?.otomasyonAktif ?? false
}

export async function getMuvekkilBildirimAyar(tenantId: string, muvekkilId: string) {
  const m = await prisma.muvekkil.findFirst({
    where: { id: muvekkilId, tenantId, aktifMi: true },
    select: { id: true, otomatikBildirimIzni: true }
  })
  if (!m) throw new AppError(404, 'Müvekkil bulunamadı.', 'NOT_FOUND')
  const pendingPlanliSayisi = await countPendingBildirimJobs({ tenantId, muvekkilId })
  const tenantOtomasyonAktif = await loadTenantOtomasyon(tenantId)
  const elig = evaluateAutoBildirimEligibility({
    tenantOtomasyonAktif,
    muvekkilIzni: m.otomatikBildirimIzni,
    dosyaAktif: true,
    taksitAktif: true
  })
  return {
    otomatikBildirimIzni: m.otomatikBildirimIzni,
    pendingPlanliSayisi,
    tenantOtomasyonAktif,
    uygunMu: elig.eligible || m.otomatikBildirimIzni,
    kullaniciMesaji: m.otomatikBildirimIzni
      ? 'Otomatik hatırlatmalar açık'
      : 'Otomatik hatırlatmalar kapalı'
  }
}

export async function setMuvekkilOtomatikBildirim(
  tenantId: string,
  userId: string,
  muvekkilId: string,
  otomatikBildirimIzni: boolean,
  req: Request
): Promise<BildirimAyarToggleResult & { otomatikBildirimIzni: boolean }> {
  const meta = getRequestMeta(req)
  const existing = await prisma.muvekkil.findFirst({
    where: { id: muvekkilId, tenantId, aktifMi: true },
    select: { id: true, otomatikBildirimIzni: true }
  })
  if (!existing) throw new AppError(404, 'Müvekkil bulunamadı.', 'NOT_FOUND')

  const pendingOnceki = await countPendingBildirimJobs({ tenantId, muvekkilId })
  let iptalEdilenSayisi = 0
  let planlananYeniden = 0

  if (existing.otomatikBildirimIzni === otomatikBildirimIzni) {
    return {
      otomatikBildirimIzni,
      aktif: otomatikBildirimIzni,
      iptalEdilenSayisi: 0,
      planlananYeniden: 0,
      pendingOnceki
    }
  }

  await prisma.muvekkil.update({
    where: { id: muvekkilId },
    data: { otomatikBildirimIzni, updatedById: userId }
  })

  if (!otomatikBildirimIzni) {
    iptalEdilenSayisi = await cancelPendingBildirimJobs(
      { tenantId, muvekkilId },
      BILDIRIM_IPTAL_NEDENI.MUVEKKIL
    )
  } else {
    const planned = await planJobsForTenant(tenantId)
    planlananYeniden = planned.created
  }

  await writeAuditLog({
    tenantId,
    userId,
    action: 'MUVEKKIL_OTOMATIK_BILDIRIM_UPDATED',
    entityType: 'Muvekkil',
    entityId: muvekkilId,
    oldValue: { otomatikBildirimIzni: existing.otomatikBildirimIzni },
    newValue: { otomatikBildirimIzni },
    meta: { muvekkilId, iptalEdilenSayisi },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return {
    otomatikBildirimIzni,
    aktif: otomatikBildirimIzni,
    iptalEdilenSayisi,
    planlananYeniden,
    pendingOnceki
  }
}

export async function getDosyaBildirimAyar(tenantId: string, dosyaId: string) {
  const d = await prisma.dosya.findFirst({
    where: { id: dosyaId, tenantId, aktifMi: true },
    select: {
      id: true,
      otomatikBildirimAktif: true,
      muvekkil: { select: { id: true, otomatikBildirimIzni: true } }
    }
  })
  if (!d) throw new AppError(404, 'Dosya bulunamadı.', 'NOT_FOUND')
  const pendingPlanliSayisi = await countPendingBildirimJobs({ tenantId, dosyaId })
  const tenantOtomasyonAktif = await loadTenantOtomasyon(tenantId)
  const elig = evaluateAutoBildirimEligibility({
    tenantOtomasyonAktif,
    muvekkilIzni: d.muvekkil.otomatikBildirimIzni,
    dosyaAktif: d.otomatikBildirimAktif,
    taksitAktif: true
  })
  return {
    otomatikBildirimAktif: d.otomatikBildirimAktif,
    muvekkilOtomatikBildirimIzni: d.muvekkil.otomatikBildirimIzni,
    pendingPlanliSayisi,
    tenantOtomasyonAktif,
    uygunMu: elig.eligible,
    kullaniciMesaji: elig.kullaniciMesaji,
    muvekkilKapaliUyari: !d.muvekkil.otomatikBildirimIzni
      ? 'Müvekkil için genel izin kapalı olduğundan bu dosyadan otomatik mesaj gönderilmez.'
      : null
  }
}

export async function setDosyaOtomatikBildirim(
  tenantId: string,
  userId: string,
  dosyaId: string,
  otomatikBildirimAktif: boolean,
  req: Request
): Promise<BildirimAyarToggleResult & { otomatikBildirimAktif: boolean }> {
  const meta = getRequestMeta(req)
  const existing = await prisma.dosya.findFirst({
    where: { id: dosyaId, tenantId, aktifMi: true },
    select: { id: true, otomatikBildirimAktif: true, muvekkilId: true }
  })
  if (!existing) throw new AppError(404, 'Dosya bulunamadı.', 'NOT_FOUND')

  const pendingOnceki = await countPendingBildirimJobs({ tenantId, dosyaId })
  let iptalEdilenSayisi = 0
  let planlananYeniden = 0

  if (existing.otomatikBildirimAktif === otomatikBildirimAktif) {
    return {
      otomatikBildirimAktif,
      aktif: otomatikBildirimAktif,
      iptalEdilenSayisi: 0,
      planlananYeniden: 0,
      pendingOnceki
    }
  }

  await prisma.dosya.update({
    where: { id: dosyaId },
    data: { otomatikBildirimAktif, updatedById: userId }
  })

  if (!otomatikBildirimAktif) {
    iptalEdilenSayisi = await cancelPendingBildirimJobs(
      { tenantId, dosyaId },
      BILDIRIM_IPTAL_NEDENI.DOSYA
    )
  } else {
    const planned = await planJobsForTenant(tenantId)
    planlananYeniden = planned.created
  }

  await writeAuditLog({
    tenantId,
    userId,
    action: 'DOSYA_OTOMATIK_BILDIRIM_UPDATED',
    entityType: 'Dosya',
    entityId: dosyaId,
    oldValue: { otomatikBildirimAktif: existing.otomatikBildirimAktif },
    newValue: { otomatikBildirimAktif },
    meta: { dosyaId, muvekkilId: existing.muvekkilId, iptalEdilenSayisi },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return {
    otomatikBildirimAktif,
    aktif: otomatikBildirimAktif,
    iptalEdilenSayisi,
    planlananYeniden,
    pendingOnceki
  }
}

export async function getTaksitBildirimAyar(tenantId: string, taksitId: string) {
  const t = await prisma.vekaletTaksiti.findFirst({
    where: { id: taksitId, tenantId },
    select: {
      id: true,
      muvekkil: { select: { otomatikBildirimIzni: true } },
      dosya: { select: { otomatikBildirimAktif: true } }
    }
  })
  if (!t) throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')
  const otomatikBildirimAktif = await getTaksitOtomatikBildirimAktif(taksitId)
  const pendingPlanliSayisi = await countPendingBildirimJobs({ tenantId, taksitId })
  const tenantOtomasyonAktif = await loadTenantOtomasyon(tenantId)
  const elig = evaluateAutoBildirimEligibility({
    tenantOtomasyonAktif,
    muvekkilIzni: t.muvekkil.otomatikBildirimIzni,
    dosyaAktif: t.dosya.otomatikBildirimAktif,
    taksitAktif: otomatikBildirimAktif
  })
  return {
    otomatikBildirimAktif,
    pendingPlanliSayisi,
    uygunMu: elig.eligible,
    kullaniciMesaji: elig.kullaniciMesaji
  }
}

export async function setTaksitOtomatikBildirim(
  tenantId: string,
  userId: string,
  taksitId: string,
  otomatikBildirimAktif: boolean,
  req: Request
): Promise<BildirimAyarToggleResult & { otomatikBildirimAktif: boolean }> {
  const meta = getRequestMeta(req)
  const existing = await prisma.vekaletTaksiti.findFirst({
    where: { id: taksitId, tenantId },
    select: {
      id: true,
      muvekkilId: true,
      dosyaId: true
    }
  })
  if (!existing) throw new AppError(404, 'Taksit bulunamadı.', 'NOT_FOUND')

  const prev = await getTaksitOtomatikBildirimAktif(taksitId)
  const pendingOnceki = await countPendingBildirimJobs({ tenantId, taksitId })
  let iptalEdilenSayisi = 0
  let planlananYeniden = 0

  if (prev === otomatikBildirimAktif) {
    return {
      otomatikBildirimAktif,
      aktif: otomatikBildirimAktif,
      iptalEdilenSayisi: 0,
      planlananYeniden: 0,
      pendingOnceki
    }
  }

  await setTaksitOtomatikBildirimAktif(taksitId, otomatikBildirimAktif)

  if (!otomatikBildirimAktif) {
    iptalEdilenSayisi = await cancelPendingBildirimJobs(
      { tenantId, taksitId },
      BILDIRIM_IPTAL_NEDENI.TAKSIT
    )
  } else {
    const planned = await planJobsForTenant(tenantId)
    planlananYeniden = planned.created
  }

  await writeAuditLog({
    tenantId,
    userId,
    action: 'TAKSIT_OTOMATIK_BILDIRIM_UPDATED',
    entityType: 'VekaletTaksiti',
    entityId: taksitId,
    oldValue: { otomatikBildirimAktif: prev },
    newValue: { otomatikBildirimAktif },
    meta: {
      taksitId,
      dosyaId: existing.dosyaId,
      muvekkilId: existing.muvekkilId,
      iptalEdilenSayisi
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return {
    otomatikBildirimAktif,
    aktif: otomatikBildirimAktif,
    iptalEdilenSayisi,
    planlananYeniden,
    pendingOnceki
  }
}
