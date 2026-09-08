import {
  BildirimKanali,
  BildirimKuralTuru,
  type Prisma,
  type TahsilatBildirimKurali,
  type TahsilatBildirimSablonu,
  WhatsAppBaglantiDurumu
} from '@prisma/client'
import type { Request } from 'express'
import { env } from '../config/env.js'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  BILDIRIM_ONERI_BASLANGIC_DK,
  BILDIRIM_ONERI_BITIS_DK,
  BILDIRIM_PENCERE_ARALIK_HATA,
  BILDIRIM_PENCERE_HATA,
  isGonderimSaatiSecilebilir,
  isIzinliAralikGecerli
} from './sendWindow.js'
import { DEFAULT_TEMPLATES } from './templates.js'
import { getPublicConnectionStatus } from './connection.public.js'
import { planRandevuJobsForTenant } from '../randevu/randevuBildirim.planner.js'
import {
  getSessizSaatleriDikkateAl,
  hasSessizSaatleriDikkateAlColumn,
  setSessizSaatleriDikkateAl
} from './sessizSaatColumn.js'

const DEFAULT_RULES: Array<{ kuralTuru: BildirimKuralTuru; gunOffset: number }> = [
  { kuralTuru: BildirimKuralTuru.VADEDEN_ONCE, gunOffset: 3 },
  { kuralTuru: BildirimKuralTuru.VADE_GUNU, gunOffset: 0 },
  { kuralTuru: BildirimKuralTuru.VADE_SONRASI, gunOffset: 3 }
]

/** Prisma SELECT listesi — sessiz kolon yokken tam model okuması patlamasın. */
const AYAR_SELECT_BASE = {
  id: true,
  tenantId: true,
  otomasyonAktif: true,
  testModu: true,
  izinliSaatBaslangic: true,
  izinliSaatBitis: true,
  otomatikSmsAktif: true,
  dusukSmsBakiyeEsigi: true,
  createdAt: true,
  updatedAt: true
} as const

type AyarRow = {
  id: string
  tenantId: string
  otomasyonAktif: boolean
  testModu: boolean
  izinliSaatBaslangic: number
  izinliSaatBitis: number
  createdAt: Date
  updatedAt: Date
  sessizSaatleriDikkateAl?: boolean
}

export function serializeAyar(a: AyarRow): Record<string, unknown> {
  return {
    id: a.id,
    tenantId: a.tenantId,
    otomasyonAktif: a.otomasyonAktif,
    testModu: a.testModu,
    izinliSaatBaslangic: a.izinliSaatBaslangic,
    izinliSaatBitis: a.izinliSaatBitis,
    sessizSaatleriDikkateAl: Boolean(a.sessizSaatleriDikkateAl),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString()
  }
}

export function serializeKural(k: TahsilatBildirimKurali & {
  metaSablonId?: string | null
  libraryKey?: string | null
}): Record<string, unknown> {
  return {
    id: k.id,
    tenantId: k.tenantId,
    kuralTuru: k.kuralTuru,
    aktifMi: k.aktifMi,
    gunOffset: k.gunOffset,
    gonderimSaatiDk: k.gonderimSaatiDk,
    kanal: k.kanal,
    metaSablonId: k.metaSablonId ?? null,
    libraryKey: k.libraryKey ?? null,
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
  const hasSessizCol = await hasSessizSaatleriDikkateAlColumn()

  if (hasSessizCol) {
    await prisma.tahsilatBildirimAyar.upsert({
      where: { tenantId },
      create: {
        tenantId,
        otomasyonAktif: false,
        testModu: true,
        izinliSaatBaslangic: BILDIRIM_ONERI_BASLANGIC_DK,
        izinliSaatBitis: BILDIRIM_ONERI_BITIS_DK,
        sessizSaatleriDikkateAl: false,
        otomatikSmsAktif: false
      },
      update: {
        otomatikSmsAktif: false
      }
    })
  } else {
    // Migration uygulanmamış DB: Prisma upsert RETURNING yeni kolonu ister → P2022.
    // Ham SQL ile eski kolon setiyle yaz.
    await prisma.$executeRaw`
      INSERT INTO tahsilat_bildirim_ayar (
        id,
        tenant_id,
        otomasyon_aktif,
        test_modu,
        izinli_saat_baslangic,
        izinli_saat_bitis,
        otomatik_sms_aktif,
        dusuk_sms_bakiye_esigi,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid()::text,
        ${tenantId},
        false,
        true,
        ${BILDIRIM_ONERI_BASLANGIC_DK},
        ${BILDIRIM_ONERI_BITIS_DK},
        false,
        100,
        NOW(),
        NOW()
      )
      ON CONFLICT (tenant_id) DO UPDATE SET
        otomatik_sms_aktif = false,
        updated_at = NOW()
    `
  }

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
        gonderimSaatiDk: BILDIRIM_ONERI_BASLANGIC_DK,
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

  await ensureWhatsAppBaglantiRow(tenantId)
}

/** Bağlantı durumu için — tahsilat ayar kolonlarına bağımlı değil. */
export async function ensureWhatsAppBaglantiRow(tenantId: string): Promise<void> {
  await prisma.whatsAppBaglanti.upsert({
    where: { tenantId },
    create: {
      tenantId,
      durum: WhatsAppBaglantiDurumu.DISABLED
    },
    update: {}
  })
}

async function loadAyarRow(tenantId: string): Promise<AyarRow> {
  const ayar = await prisma.tahsilatBildirimAyar.findUniqueOrThrow({
    where: { tenantId },
    select: AYAR_SELECT_BASE
  })
  const sessizSaatleriDikkateAl = await getSessizSaatleriDikkateAl(tenantId)
  return { ...ayar, sessizSaatleriDikkateAl }
}

export async function getSettings(tenantId: string): Promise<{
  ayar: Record<string, unknown>
  kurallar: Record<string, unknown>[]
  sablonlar: Record<string, unknown>[]
  whatsapp: Record<string, unknown>
}> {
  await ensureTenantBildirimDefaults(tenantId)

  const [ayar, kurallar, sablonlar] = await Promise.all([
    loadAyarRow(tenantId),
    prisma.tahsilatBildirimKurali.findMany({
      where: { tenantId, kanal: BildirimKanali.WHATSAPP },
      orderBy: { kuralTuru: 'asc' }
    }),
    prisma.tahsilatBildirimSablonu.findMany({
      where: { tenantId, kanal: BildirimKanali.WHATSAPP },
      orderBy: { kuralTuru: 'asc' }
    })
  ])

  return {
    ayar: serializeAyar(ayar),
    kurallar: kurallar.map(serializeKural),
    sablonlar: sablonlar.map(serializeSablon),
    whatsapp: await getWhatsAppDurum(tenantId)
  }
}

export type UpdateSettingsBody = {
  otomasyonAktif?: boolean
  testModu?: boolean
  izinliSaatBaslangic?: number
  izinliSaatBitis?: number
  sessizSaatleriDikkateAl?: boolean
}

export async function updateSettings(
  tenantId: string,
  userId: string,
  body: UpdateSettingsBody,
  req: Request
): Promise<Record<string, unknown>> {
  await ensureTenantBildirimDefaults(tenantId)
  const existing = await loadAyarRow(tenantId)

  const nextBas = body.izinliSaatBaslangic ?? existing.izinliSaatBaslangic
  const nextBit = body.izinliSaatBitis ?? existing.izinliSaatBitis
  if (
    (body.izinliSaatBaslangic !== undefined || body.izinliSaatBitis !== undefined) &&
    !isIzinliAralikGecerli(nextBas, nextBit)
  ) {
    throw new AppError(400, BILDIRIM_PENCERE_ARALIK_HATA, 'INVALID_WINDOW')
  }

  if (body.sessizSaatleriDikkateAl !== undefined) {
    if (!(await hasSessizSaatleriDikkateAlColumn())) {
      throw new AppError(
        503,
        'Sessiz saat ayarı için veritabanı güncellemesi gerekir. Migration henüz uygulanmadı.',
        'MIGRATION_REQUIRED'
      )
    }
  }

  const data: Prisma.TahsilatBildirimAyarUpdateInput = {
    otomatikSmsAktif: false
  }
  if (body.otomasyonAktif !== undefined) data.otomasyonAktif = body.otomasyonAktif
  if (body.testModu !== undefined) data.testModu = body.testModu
  if (body.izinliSaatBaslangic !== undefined) data.izinliSaatBaslangic = body.izinliSaatBaslangic
  if (body.izinliSaatBitis !== undefined) data.izinliSaatBitis = body.izinliSaatBitis

  await prisma.tahsilatBildirimAyar.update({
    where: { tenantId },
    data,
    select: AYAR_SELECT_BASE
  })

  if (body.sessizSaatleriDikkateAl !== undefined) {
    try {
      await setSessizSaatleriDikkateAl(tenantId, body.sessizSaatleriDikkateAl)
    } catch {
      throw new AppError(
        503,
        'Sessiz saat ayarı kaydedilemedi. Veritabanı güncellemesi gerekir.',
        'MIGRATION_REQUIRED'
      )
    }
  }

  const updated = await loadAyarRow(tenantId)

  const quietRelatedChanged =
    body.sessizSaatleriDikkateAl !== undefined ||
    body.izinliSaatBaslangic !== undefined ||
    body.izinliSaatBitis !== undefined
  if (quietRelatedChanged) {
    await planRandevuJobsForTenant(tenantId)
  }

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

  if (body.gonderimSaatiDk !== undefined && !isGonderimSaatiSecilebilir(body.gonderimSaatiDk)) {
    throw new AppError(400, BILDIRIM_PENCERE_HATA, 'INVALID_SEND_TIME')
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
  await ensureWhatsAppBaglantiRow(tenantId)
  const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId } })
  if (!baglanti) {
    return {
      durum: WhatsAppBaglantiDurumu.DISABLED,
      wabaIdMasked: null,
      phoneNumberIdMasked: null,
      sonHataOzeti: null,
      aktifProvider: 'MANUAL_WHATSAPP',
      cloudApiEnabled: env.WHATSAPP_CLOUD_API_ENABLED,
      gercekGonderimAktif: false,
      connected: false,
      provider: 'META_CLOUD',
      bilgi: 'WhatsApp Cloud API bağlantısı henüz kurulmadı.'
    }
  }

  const publicStatus = getPublicConnectionStatus(baglanti)
  return {
    ...publicStatus,
    bilgi: publicStatus.connected
      ? 'WhatsApp Cloud API bağlı; otomatik gönderim (flag açıkken) Cloud üzerinden yapılır.'
      : 'Bildirimler WhatsApp üzerinden, kendi WhatsApp hesabınız kullanılarak gönderilir.'
  }
}
