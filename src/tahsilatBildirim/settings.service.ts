import {
  BildirimKanali,
  BildirimKuralTuru,
  type Prisma,
  type TahsilatBildirimAyar,
  type TahsilatBildirimKurali,
  type TahsilatBildirimSablonu,
  WhatsAppBaglantiDurumu
} from '@prisma/client'
import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { DEFAULT_TEMPLATES } from './templates.js'

const DEFAULT_RULES: Array<{ kuralTuru: BildirimKuralTuru; gunOffset: number }> = [
  { kuralTuru: BildirimKuralTuru.VADEDEN_ONCE, gunOffset: 3 },
  { kuralTuru: BildirimKuralTuru.VADE_GUNU, gunOffset: 0 },
  { kuralTuru: BildirimKuralTuru.VADE_SONRASI, gunOffset: 3 }
]

export function serializeAyar(a: TahsilatBildirimAyar): Record<string, unknown> {
  return {
    id: a.id,
    tenantId: a.tenantId,
    otomasyonAktif: a.otomasyonAktif,
    testModu: a.testModu,
    izinliSaatBaslangic: a.izinliSaatBaslangic,
    izinliSaatBitis: a.izinliSaatBitis,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString()
  }
}

export function serializeKural(k: TahsilatBildirimKurali): Record<string, unknown> {
  return {
    id: k.id,
    tenantId: k.tenantId,
    kuralTuru: k.kuralTuru,
    aktifMi: k.aktifMi,
    gunOffset: k.gunOffset,
    gonderimSaatiDk: k.gonderimSaatiDk,
    kanal: k.kanal,
    createdAt: k.createdAt.toISOString(),
    updatedAt: k.updatedAt.toISOString()
  }
}

export function serializeSablon(s: TahsilatBildirimSablonu): Record<string, unknown> {
  return {
    id: s.id,
    tenantId: s.tenantId,
    kuralTuru: s.kuralTuru,
    kanal: s.kanal,
    metin: s.metin,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString()
  }
}

export async function ensureTenantBildirimDefaults(tenantId: string): Promise<void> {
  await prisma.tahsilatBildirimAyar.upsert({
    where: { tenantId },
    create: {
      tenantId,
      otomasyonAktif: false,
      testModu: true,
      izinliSaatBaslangic: 600,
      izinliSaatBitis: 1200
    },
    update: {}
  })

  for (const rule of DEFAULT_RULES) {
    await prisma.tahsilatBildirimKurali.upsert({
      where: {
        tenantId_kuralTuru_kanal: {
          tenantId,
          kuralTuru: rule.kuralTuru,
          kanal: BildirimKanali.WHATSAPP
        }
      },
      create: {
        tenantId,
        kuralTuru: rule.kuralTuru,
        aktifMi: false,
        gunOffset: rule.gunOffset,
        gonderimSaatiDk: 600,
        kanal: BildirimKanali.WHATSAPP
      },
      update: {}
    })

    await prisma.tahsilatBildirimSablonu.upsert({
      where: {
        tenantId_kuralTuru_kanal: {
          tenantId,
          kuralTuru: rule.kuralTuru,
          kanal: BildirimKanali.WHATSAPP
        }
      },
      create: {
        tenantId,
        kuralTuru: rule.kuralTuru,
        kanal: BildirimKanali.WHATSAPP,
        metin: DEFAULT_TEMPLATES[rule.kuralTuru]
      },
      update: {}
    })
  }

  await prisma.whatsAppBaglanti.upsert({
    where: { tenantId },
    create: {
      tenantId,
      durum: WhatsAppBaglantiDurumu.BAGLI_DEGIL
    },
    update: {}
  })
}

export async function getSettings(tenantId: string): Promise<{
  ayar: Record<string, unknown>
  kurallar: Record<string, unknown>[]
  sablonlar: Record<string, unknown>[]
  whatsapp: Record<string, unknown>
}> {
  await ensureTenantBildirimDefaults(tenantId)

  const [ayar, kurallar, sablonlar, baglanti] = await Promise.all([
    prisma.tahsilatBildirimAyar.findUniqueOrThrow({ where: { tenantId } }),
    prisma.tahsilatBildirimKurali.findMany({
      where: { tenantId },
      orderBy: { kuralTuru: 'asc' }
    }),
    prisma.tahsilatBildirimSablonu.findMany({
      where: { tenantId },
      orderBy: { kuralTuru: 'asc' }
    }),
    prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  ])

  return {
    ayar: serializeAyar(ayar),
    kurallar: kurallar.map(serializeKural),
    sablonlar: sablonlar.map(serializeSablon),
    whatsapp: {
      durum: baglanti?.durum ?? WhatsAppBaglantiDurumu.BAGLI_DEGIL,
      wabaIdMasked: baglanti?.wabaIdMasked ?? null,
      phoneNumberIdMasked: baglanti?.phoneNumberIdMasked ?? null,
      sonHataOzeti: baglanti?.sonHataOzeti ?? null
    }
  }
}

export type UpdateSettingsBody = {
  otomasyonAktif?: boolean
  testModu?: boolean
  izinliSaatBaslangic?: number
  izinliSaatBitis?: number
}

export async function updateSettings(
  tenantId: string,
  userId: string,
  body: UpdateSettingsBody,
  req: Request
): Promise<Record<string, unknown>> {
  await ensureTenantBildirimDefaults(tenantId)
  const existing = await prisma.tahsilatBildirimAyar.findUniqueOrThrow({ where: { tenantId } })

  if (
    body.izinliSaatBaslangic != null &&
    body.izinliSaatBitis != null &&
    body.izinliSaatBaslangic >= body.izinliSaatBitis
  ) {
    throw new AppError(400, 'İzinli saat başlangıcı bitişten küçük olmalıdır.', 'INVALID_WINDOW')
  }

  const data: Prisma.TahsilatBildirimAyarUpdateInput = {}
  if (body.otomasyonAktif !== undefined) data.otomasyonAktif = body.otomasyonAktif
  if (body.testModu !== undefined) data.testModu = body.testModu
  if (body.izinliSaatBaslangic !== undefined) data.izinliSaatBaslangic = body.izinliSaatBaslangic
  if (body.izinliSaatBitis !== undefined) data.izinliSaatBitis = body.izinliSaatBitis

  const updated = await prisma.tahsilatBildirimAyar.update({
    where: { tenantId },
    data
  })

  const meta = getRequestMeta(req)
  await writeAuditLog({
    tenantId,
    userId,
    action: 'TAHSILAT_BILDIRIM_AYAR_UPDATED',
    entityType: 'TahsilatBildirimAyar',
    entityId: updated.id,
    oldValue: serializeAyar(existing),
    newValue: serializeAyar(updated),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeAyar(updated)
}

export type UpdateRuleBody = {
  aktifMi?: boolean
  gunOffset?: number
  gonderimSaatiDk?: number
}

export async function updateRule(
  tenantId: string,
  userId: string,
  ruleId: string,
  body: UpdateRuleBody,
  req: Request
): Promise<Record<string, unknown>> {
  const existing = await prisma.tahsilatBildirimKurali.findFirst({
    where: { id: ruleId, tenantId }
  })
  if (!existing) {
    throw new AppError(404, 'Bildirim kuralı bulunamadı.', 'NOT_FOUND')
  }

  if (body.gunOffset != null) {
    if (existing.kuralTuru === BildirimKuralTuru.VADE_GUNU && body.gunOffset !== 0) {
      throw new AppError(400, 'Vade günü kuralında gün ofseti 0 olmalıdır.', 'INVALID_OFFSET')
    }
    if (existing.kuralTuru !== BildirimKuralTuru.VADE_GUNU && body.gunOffset < 1) {
      throw new AppError(400, 'Gün ofseti en az 1 olmalıdır.', 'INVALID_OFFSET')
    }
  }

  const updated = await prisma.tahsilatBildirimKurali.update({
    where: { id: ruleId },
    data: {
      ...(body.aktifMi !== undefined ? { aktifMi: body.aktifMi } : {}),
      ...(body.gunOffset !== undefined ? { gunOffset: body.gunOffset } : {}),
      ...(body.gonderimSaatiDk !== undefined ? { gonderimSaatiDk: body.gonderimSaatiDk } : {})
    }
  })

  const meta = getRequestMeta(req)
  await writeAuditLog({
    tenantId,
    userId,
    action: 'TAHSILAT_BILDIRIM_KURAL_UPDATED',
    entityType: 'TahsilatBildirimKurali',
    entityId: updated.id,
    oldValue: serializeKural(existing),
    newValue: serializeKural(updated),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeKural(updated)
}

export type UpdateTemplateBody = {
  metin: string
}

export async function updateTemplate(
  tenantId: string,
  userId: string,
  templateId: string,
  body: UpdateTemplateBody,
  req: Request
): Promise<Record<string, unknown>> {
  const existing = await prisma.tahsilatBildirimSablonu.findFirst({
    where: { id: templateId, tenantId }
  })
  if (!existing) {
    throw new AppError(404, 'Bildirim şablonu bulunamadı.', 'NOT_FOUND')
  }

  const metin = body.metin.trim()
  if (metin.length < 10) {
    throw new AppError(400, 'Şablon metni çok kısa.', 'INVALID_TEMPLATE')
  }

  const updated = await prisma.tahsilatBildirimSablonu.update({
    where: { id: templateId },
    data: { metin }
  })

  const meta = getRequestMeta(req)
  await writeAuditLog({
    tenantId,
    userId,
    action: 'TAHSILAT_BILDIRIM_SABLON_UPDATED',
    entityType: 'TahsilatBildirimSablonu',
    entityId: updated.id,
    oldValue: serializeSablon(existing),
    newValue: serializeSablon(updated),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return serializeSablon(updated)
}

export async function getWhatsAppDurum(tenantId: string): Promise<Record<string, unknown>> {
  await ensureTenantBildirimDefaults(tenantId)
  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  return {
    durum: baglanti?.durum ?? WhatsAppBaglantiDurumu.BAGLI_DEGIL,
    wabaIdMasked: baglanti?.wabaIdMasked ?? null,
    phoneNumberIdMasked: baglanti?.phoneNumberIdMasked ?? null,
    sonHataOzeti: baglanti?.sonHataOzeti ?? null,
    gercekGonderimAktif: false
  }
}
