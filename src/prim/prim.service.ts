import type { PrimKurali, Prisma, UserRole } from '@prisma/client'
import {
  IcraTahsilatAlacakDurum as IcraAlacakDurumEnum,
  OfisKasaOnayDurumu,
  PrimDonemOdemeDurumu,
  PrimHesaplamaTipi,
  PrimKuralKapsam,
  Prisma as PrismaNs
} from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { tahsilatIcraPersonelWhere } from '../lib/primTahsilatFilter.js'
import { AppError } from '../middleware/errorHandler.js'
import type { CreatePrimKuralBody, PersonelPanelDetayQuery, PersonelPanelOzetQuery, PrimRaporQuery, UpdatePrimKuralBody } from './prim.schemas.js'
import { calcProgressivePremium, calcTotalBracketPremium } from './primCalc.js'

const YONETICI_ROLLER: UserRole[] = ['BURO_SAHIBI', 'AVUKAT_YONETICI']

export type TahsilatKaynak = 'DOSYA_AVANS' | 'VEKALET' | 'OFIS_GELIR' | 'ICRA'

export type PrimKuralWithKademeler = PrimKurali & {
  kademeler: { id: string; minTutar: Prisma.Decimal; maxTutar: Prisma.Decimal | null; oranYuzde: Prisma.Decimal; siraNo: number }[]
}

export type TahsilatSatir = {
  id: string
  kaynak: TahsilatKaynak
  tarih: string
  tutar: string
  aciklama: string | null
  muvekkilAd: string | null
  dosyaBaslik: string | null
  kasaTuru: string
  kaynakKayitId: string
}

function dec(d: Prisma.Decimal): string {
  return d.toFixed(2)
}

function monthRange(yil: number, ay: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(yil, ay - 1, 1, 0, 0, 0, 0))
  const end = new Date(Date.UTC(yil, ay, 1, 0, 0, 0, 0))
  return { start, end }
}

function isYonetici(role: UserRole): boolean {
  return YONETICI_ROLLER.includes(role)
}

function serializeKural(
  k: PrimKurali & {
    kademeler: { id: string; minTutar: Prisma.Decimal; maxTutar: Prisma.Decimal | null; oranYuzde: Prisma.Decimal; siraNo: number }[]
    user?: { id: string; adSoyad: string } | null
    primPersonel?: { id: string; adSoyad: string } | null
  }
) {
  return {
    id: k.id,
    tenantId: k.tenantId,
    ad: k.ad,
    aktifMi: k.aktifMi,
    kapsam: k.kapsam,
    userId: k.userId,
    userAdSoyad: k.user?.adSoyad ?? null,
    primPersonelId: k.primPersonelId,
    primPersonelAdSoyad: k.primPersonel?.adSoyad ?? null,
    hesaplamaTipi: k.hesaplamaTipi,
    donemTipi: k.donemTipi,
    dosyaTahsilatMi: k.dosyaTahsilatMi,
    vekaletTahsilatMi: k.vekaletTahsilatMi,
    ofisKasaGelirMi: k.ofisKasaGelirMi,
    icraTahsilatMi: k.icraTahsilatMi,
    kademeler: k.kademeler
      .sort((a, b) => a.siraNo - b.siraNo)
      .map((t) => ({
        id: t.id,
        minTutar: dec(t.minTutar),
        maxTutar: t.maxTutar != null ? dec(t.maxTutar) : null,
        oranYuzde: dec(t.oranYuzde),
        siraNo: t.siraNo
      })),
    createdAt: k.createdAt.toISOString(),
    updatedAt: k.updatedAt.toISOString()
  }
}

export async function listPrimKurallari(tenantId: string) {
  const rows = await prisma.primKurali.findMany({
    where: { tenantId },
    include: {
      kademeler: true,
      user: { select: { id: true, adSoyad: true } },
      primPersonel: { select: { id: true, adSoyad: true } }
    },
    orderBy: [{ aktifMi: 'desc' }, { createdAt: 'desc' }]
  })
  return rows.map(serializeKural)
}

async function assertPrimPersonelInTenant(tenantId: string, primPersonelId: string) {
  const p = await prisma.primPersonel.findFirst({ where: { id: primPersonelId, tenantId } })
  if (!p) throw new AppError(400, 'Geçersiz personel.', 'INVALID_PERSONEL')
  return p
}

async function assertPrimPersonelAccess(
  tenantId: string,
  actorUserId: string,
  actorRole: UserRole,
  primPersonelId: string
) {
  const personel = await assertPrimPersonelInTenant(tenantId, primPersonelId)
  if (!isYonetici(actorRole) && personel.bagliUserId !== actorUserId) {
    throw new AppError(403, 'Yalnızca kendi prim bilginizi görüntüleyebilirsiniz.', 'FORBIDDEN')
  }
  return personel
}

async function deactivateConflictingRules(
  tx: Prisma.TransactionClient,
  tenantId: string,
  kapsam: PrimKuralKapsam,
  primPersonelId: string | null,
  exceptId?: string
) {
  await tx.primKurali.updateMany({
    where: {
      tenantId,
      kapsam,
      primPersonelId: kapsam === PrimKuralKapsam.USER_SPECIFIC ? primPersonelId : null,
      aktifMi: true,
      ...(exceptId ? { id: { not: exceptId } } : {})
    },
    data: { aktifMi: false }
  })
}

export async function createPrimKurali(tenantId: string, body: CreatePrimKuralBody) {
  if (body.primPersonelId) await assertPrimPersonelInTenant(tenantId, body.primPersonelId)

  const created = await prisma.$transaction(async (tx) => {
    if (body.aktifMi !== false) {
      await deactivateConflictingRules(tx, tenantId, body.kapsam, body.primPersonelId ?? null)
    }
    return tx.primKurali.create({
      data: {
        tenantId,
        ad: body.ad,
        aktifMi: body.aktifMi ?? true,
        kapsam: body.kapsam,
        primPersonelId: body.kapsam === PrimKuralKapsam.USER_SPECIFIC ? body.primPersonelId! : null,
        userId: null,
        hesaplamaTipi: body.hesaplamaTipi,
        dosyaTahsilatMi: body.dosyaTahsilatMi ?? true,
        vekaletTahsilatMi: body.vekaletTahsilatMi ?? true,
        ofisKasaGelirMi: body.ofisKasaGelirMi ?? true,
        icraTahsilatMi: body.icraTahsilatMi ?? false,
        kademeler: {
          create: body.kademeler.map((k: CreatePrimKuralBody['kademeler'][number], i: number) => ({
            tenantId,
            minTutar: new PrismaNs.Decimal(k.minTutar),
            maxTutar: k.maxTutar != null ? new PrismaNs.Decimal(k.maxTutar) : null,
            oranYuzde: new PrismaNs.Decimal(k.oranYuzde),
            siraNo: k.siraNo ?? i
          }))
        }
      },
      include: {
        kademeler: true,
        user: { select: { id: true, adSoyad: true } },
        primPersonel: { select: { id: true, adSoyad: true } }
      }
    })
  })
  return serializeKural(created)
}

export async function updatePrimKurali(tenantId: string, id: string, body: UpdatePrimKuralBody) {
  const existing = await prisma.primKurali.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'Prim kuralı bulunamadı.', 'NOT_FOUND')

  const kapsam = body.kapsam ?? existing.kapsam
  const primPersonelId =
    kapsam === PrimKuralKapsam.USER_SPECIFIC ? (body.primPersonelId ?? existing.primPersonelId) : null
  if (primPersonelId) await assertPrimPersonelInTenant(tenantId, primPersonelId)

  const updated = await prisma.$transaction(async (tx) => {
    if (body.aktifMi === true || (body.aktifMi === undefined && existing.aktifMi)) {
      await deactivateConflictingRules(tx, tenantId, kapsam, primPersonelId, id)
    }
    if (body.kademeler) {
      await tx.primKuralKademesi.deleteMany({ where: { kuralId: id, tenantId } })
    }
    return tx.primKurali.update({
      where: { id },
      data: {
        ad: body.ad,
        aktifMi: body.aktifMi,
        kapsam,
        primPersonelId,
        userId: null,
        hesaplamaTipi: body.hesaplamaTipi,
        dosyaTahsilatMi: body.dosyaTahsilatMi,
        vekaletTahsilatMi: body.vekaletTahsilatMi,
        ofisKasaGelirMi: body.ofisKasaGelirMi,
        icraTahsilatMi: body.icraTahsilatMi,
        ...(body.kademeler
          ? {
              kademeler: {
                create: body.kademeler.map((k: CreatePrimKuralBody['kademeler'][number], i: number) => ({
                  tenantId,
                  minTutar: new PrismaNs.Decimal(k.minTutar),
                  maxTutar: k.maxTutar != null ? new PrismaNs.Decimal(k.maxTutar) : null,
                  oranYuzde: new PrismaNs.Decimal(k.oranYuzde),
                  siraNo: k.siraNo ?? i
                }))
              }
            }
          : {})
      },
      include: {
        kademeler: true,
        user: { select: { id: true, adSoyad: true } },
        primPersonel: { select: { id: true, adSoyad: true } }
      }
    })
  })
  return serializeKural(updated)
}

export async function pasifPrimKurali(tenantId: string, id: string) {
  const existing = await prisma.primKurali.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'Prim kuralı bulunamadı.', 'NOT_FOUND')
  const updated = await prisma.primKurali.update({
    where: { id },
    data: { aktifMi: false },
    include: {
      kademeler: true,
      user: { select: { id: true, adSoyad: true } },
      primPersonel: { select: { id: true, adSoyad: true } }
    }
  })
  return serializeKural(updated)
}

export async function resolvePrimKuraliForPersonel(tenantId: string, primPersonelId: string) {
  const personelRule = await prisma.primKurali.findFirst({
    where: { tenantId, kapsam: PrimKuralKapsam.USER_SPECIFIC, primPersonelId, aktifMi: true },
    include: {
      kademeler: true,
      user: { select: { id: true, adSoyad: true } },
      primPersonel: { select: { id: true, adSoyad: true } }
    }
  })
  if (personelRule) return personelRule
  return prisma.primKurali.findFirst({
    where: { tenantId, kapsam: PrimKuralKapsam.TENANT_DEFAULT, aktifMi: true },
    include: {
      kademeler: true,
      user: { select: { id: true, adSoyad: true } },
      primPersonel: { select: { id: true, adSoyad: true } }
    }
  })
}

function toTahsilatSatir(row: PersonelTahsilatSatir): TahsilatSatir {
  return {
    id: row.id,
    kaynak: row.kaynak,
    tarih: row.tarih,
    tutar: row.tutar,
    aciklama: row.aciklama,
    muvekkilAd: row.muvekkilAd,
    dosyaBaslik: row.dosyaBaslik,
    kasaTuru: row.kasaTuru,
    kaynakKayitId: row.kaynakKayitId
  }
}

function computePremium(
  total: number,
  hesaplamaTipi: PrimHesaplamaTipi,
  tiers: { minTutar: Prisma.Decimal; maxTutar: Prisma.Decimal | null; oranYuzde: Prisma.Decimal; siraNo: number }[]
) {
  const input = tiers.map((t) => ({
    minTutar: Number(t.minTutar),
    maxTutar: t.maxTutar != null ? Number(t.maxTutar) : null,
    oranYuzde: Number(t.oranYuzde),
    siraNo: t.siraNo
  }))
  if (hesaplamaTipi === PrimHesaplamaTipi.PROGRESSIVE) {
    return calcProgressivePremium(total, input)
  }
  return calcTotalBracketPremium(total, input)
}

export async function hesaplaPrimRaporu(
  tenantId: string,
  actorUserId: string,
  actorRole: UserRole,
  query: PrimRaporQuery
) {
  const yonetici = isYonetici(actorRole)
  let personelIds: string[]

  if (query.primPersonelId) {
    await assertPrimPersonelAccess(tenantId, actorUserId, actorRole, query.primPersonelId)
    personelIds = [query.primPersonelId]
  } else if (query.userId) {
    const linked = await prisma.primPersonel.findFirst({
      where: { tenantId, bagliUserId: query.userId }
    })
    if (!linked) {
      if (!yonetici && query.userId !== actorUserId) {
        throw new AppError(403, 'Yalnızca kendi prim raporunuzu görüntüleyebilirsiniz.', 'FORBIDDEN')
      }
      return []
    }
    await assertPrimPersonelAccess(tenantId, actorUserId, actorRole, linked.id)
    personelIds = [linked.id]
  } else if (yonetici) {
    const personeller = await prisma.primPersonel.findMany({
      where: { tenantId },
      select: { id: true }
    })
    personelIds = personeller.map((p) => p.id)
  } else {
    const linked = await prisma.primPersonel.findFirst({
      where: { tenantId, bagliUserId: actorUserId },
      select: { id: true }
    })
    personelIds = linked ? [linked.id] : []
  }

  const results = []
  for (const primPersonelId of personelIds) {
    const personel = await prisma.primPersonel.findFirst({
      where: { id: primPersonelId, tenantId },
      select: { id: true, adSoyad: true, bagliUserId: true }
    })
    if (!personel) continue

    const rule = await resolvePrimKuraliForPersonel(tenantId, primPersonelId)
    if (!rule) {
      results.push({
        primPersonelId: personel.id,
        primPersonelAdSoyad: personel.adSoyad,
        userId: personel.bagliUserId,
        yil: query.yil,
        ay: query.ay,
        toplamTahsilat: '0.00',
        hesaplananPrim: '0.00',
        uygulananKuralAd: null,
        hesaplamaTipi: null,
        durum: null,
        primDonemId: null
      })
      continue
    }

    const allRows = await collectPersonelTahsilatlari(
      tenantId,
      primPersonelId,
      personel.adSoyad,
      personel.bagliUserId,
      query.yil,
      query.ay,
      rule,
      query.tahsilatTuru
    )
    const primRows = allRows.filter((r) => r.primHesabinaDahilMi)
    const primToplam = primRows.reduce((s, t) => s + Number(t.tutar), 0)
    const hesap = computePremium(primToplam, rule.hesaplamaTipi, rule.kademeler)

    const saved = await prisma.primDonemOdemesi.upsert({
      where: {
        tenantId_primPersonelId_yil_ay: { tenantId, primPersonelId, yil: query.yil, ay: query.ay }
      },
      create: {
        tenantId,
        primPersonelId,
        userId: personel.bagliUserId,
        yil: query.yil,
        ay: query.ay,
        toplamTahsilat: new PrismaNs.Decimal(primToplam),
        hesaplananPrim: new PrismaNs.Decimal(hesap.toplamPrim),
        uygulananKuralId: rule.id,
        hesaplamaTipi: rule.hesaplamaTipi,
        hesaplamaDetay: {
          kademeler: hesap.kademeler,
          tahsilatSayisi: primRows.length,
          toplamTahsilatBuAy: allRows.reduce((s, t) => s + Number(t.tutar), 0)
        },
        durum: PrimDonemOdemeDurumu.HESAPLANDI
      },
      update: {
        userId: personel.bagliUserId,
        toplamTahsilat: new PrismaNs.Decimal(primToplam),
        hesaplananPrim: new PrismaNs.Decimal(hesap.toplamPrim),
        uygulananKuralId: rule.id,
        hesaplamaTipi: rule.hesaplamaTipi,
        hesaplamaDetay: {
          kademeler: hesap.kademeler,
          tahsilatSayisi: primRows.length,
          toplamTahsilatBuAy: allRows.reduce((s, t) => s + Number(t.tutar), 0)
        },
        durum: PrimDonemOdemeDurumu.HESAPLANDI,
        odendiTarihi: null,
        odendiIsaretleyenId: null
      }
    })

    results.push({
      primDonemId: saved.id,
      primPersonelId: personel.id,
      primPersonelAdSoyad: personel.adSoyad,
      userId: personel.bagliUserId,
      yil: query.yil,
      ay: query.ay,
      toplamTahsilat: dec(saved.toplamTahsilat),
      hesaplananPrim: dec(saved.hesaplananPrim),
      uygulananKuralAd: rule.ad,
      hesaplamaTipi: rule.hesaplamaTipi,
      durum: saved.durum
    })
  }

  return results
}

export async function getPrimRaporDetay(
  tenantId: string,
  actorUserId: string,
  actorRole: UserRole,
  primDonemId: string
) {
  const row = await prisma.primDonemOdemesi.findFirst({
    where: { id: primDonemId, tenantId },
    include: {
      user: { select: { id: true, adSoyad: true } },
      primPersonel: { select: { id: true, adSoyad: true, bagliUserId: true } }
    }
  })
  if (!row) throw new AppError(404, 'Prim kaydı bulunamadı.', 'NOT_FOUND')
  if (!isYonetici(actorRole) && row.primPersonel.bagliUserId !== actorUserId) {
    throw new AppError(403, 'Yalnızca kendi prim detayınızı görüntüleyebilirsiniz.', 'FORBIDDEN')
  }

  const rule = row.uygulananKuralId
    ? await prisma.primKurali.findFirst({
        where: { id: row.uygulananKuralId, tenantId },
        include: { kademeler: true }
      })
    : await resolvePrimKuraliForPersonel(tenantId, row.primPersonelId)

  const tahsilatlar = rule
    ? await collectTahsilatlar(
        tenantId,
        row.primPersonelId,
        row.primPersonel.adSoyad,
        row.primPersonel.bagliUserId,
        row.yil,
        row.ay,
        rule,
        'TUMU'
      )
    : []

  const detay = row.hesaplamaDetay as { kademeler?: unknown[] } | null

  return {
    ozet: {
      primDonemId: row.id,
      primPersonelId: row.primPersonelId,
      primPersonelAdSoyad: row.primPersonel.adSoyad,
      userId: row.userId,
      userAdSoyad: row.user?.adSoyad ?? null,
      yil: row.yil,
      ay: row.ay,
      toplamTahsilat: dec(row.toplamTahsilat),
      hesaplananPrim: dec(row.hesaplananPrim),
      uygulananKuralAd: rule?.ad ?? null,
      hesaplamaTipi: row.hesaplamaTipi,
      durum: row.durum,
      odendiTarihi: row.odendiTarihi?.toISOString() ?? null,
      not: row.not
    },
    kademeHesabi: detay?.kademeler ?? [],
    tahsilatlar
  }
}

export async function markPrimOdendi(
  tenantId: string,
  actorUserId: string,
  actorRole: UserRole,
  primDonemId: string,
  not?: string | null
) {
  if (!isYonetici(actorRole)) {
    throw new AppError(403, 'Prim ödendi işaretlemesi yalnızca yönetici tarafından yapılabilir.', 'FORBIDDEN')
  }
  const row = await prisma.primDonemOdemesi.findFirst({ where: { id: primDonemId, tenantId } })
  if (!row) throw new AppError(404, 'Prim kaydı bulunamadı.', 'NOT_FOUND')

  const updated = await prisma.primDonemOdemesi.update({
    where: { id: primDonemId },
    data: {
      durum: PrimDonemOdemeDurumu.ODENDI,
      odendiTarihi: new Date(),
      odendiIsaretleyenId: actorUserId,
      not: not?.trim() || null
    },
    include: {
      user: { select: { id: true, adSoyad: true } },
      primPersonel: { select: { id: true, adSoyad: true } }
    }
  })

  return {
    id: updated.id,
    durum: updated.durum,
    odendiTarihi: updated.odendiTarihi?.toISOString() ?? null,
    primPersonelAdSoyad: updated.primPersonel.adSoyad
  }
}

export async function listPrimRaporOzet(
  tenantId: string,
  actorUserId: string,
  actorRole: UserRole,
  query: PrimRaporQuery
) {
  const visiblePersonel = await listVisiblePrimPersonel(tenantId, actorUserId, actorRole)
  const visibleIds = visiblePersonel.map((p) => p.id)

  const where: Prisma.PrimDonemOdemesiWhereInput = {
    tenantId,
    yil: query.yil,
    ay: query.ay,
    primPersonelId: { in: visibleIds },
    ...(query.primPersonelId ? { primPersonelId: query.primPersonelId } : {}),
    ...(query.userId
      ? {
          primPersonel: { bagliUserId: query.userId }
        }
      : {})
  }

  const rows = await prisma.primDonemOdemesi.findMany({
    where,
    include: {
      user: { select: { id: true, adSoyad: true } },
      primPersonel: { select: { id: true, adSoyad: true } }
    },
    orderBy: [{ primPersonel: { adSoyad: 'asc' } }]
  })

  const kuralIds = [...new Set(rows.map((r) => r.uygulananKuralId).filter(Boolean))] as string[]
  const kurallar = kuralIds.length
    ? await prisma.primKurali.findMany({ where: { tenantId, id: { in: kuralIds } }, select: { id: true, ad: true } })
    : []
  const kuralMap = new Map(kurallar.map((k) => [k.id, k.ad]))

  return rows.map((r) => ({
    primDonemId: r.id,
    primPersonelId: r.primPersonelId,
    primPersonelAdSoyad: r.primPersonel.adSoyad,
    userId: r.userId,
    userAdSoyad: r.user?.adSoyad ?? null,
    yil: r.yil,
    ay: r.ay,
    toplamTahsilat: dec(r.toplamTahsilat),
    hesaplananPrim: dec(r.hesaplananPrim),
    uygulananKuralAd: r.uygulananKuralId ? (kuralMap.get(r.uygulananKuralId) ?? null) : null,
    hesaplamaTipi: r.hesaplamaTipi,
    durum: r.durum
  }))
}

export type TahsilatOnayDurumu = 'ONAYSIZ' | 'ONAYLI' | 'REDDEDILDI'

export type PersonelTahsilatSatir = TahsilatSatir & {
  onayDurumu: TahsilatOnayDurumu
  primHesabinaDahilMi: boolean
  tahsilatiYapanPersonelId: string
  tahsilatiYapanAdSoyad: string
}

function kaynakRuleEnabled(rule: PrimKuralWithKademeler | null, kaynak: TahsilatKaynak): boolean {
  if (!rule) return false
  if (kaynak === 'DOSYA_AVANS') return rule.dosyaTahsilatMi
  if (kaynak === 'VEKALET') return rule.vekaletTahsilatMi
  if (kaynak === 'OFIS_GELIR') return rule.ofisKasaGelirMi
  if (kaynak === 'ICRA') return rule.icraTahsilatMi
  return false
}

async function collectPersonelTahsilatlari(
  tenantId: string,
  primPersonelId: string,
  personelAdSoyad: string,
  bagliUserId: string | null,
  yil: number,
  ay: number,
  rule: PrimKuralWithKademeler | null,
  tahsilatTuruFilter: PersonelPanelDetayQuery['tahsilatTuru']
): Promise<PersonelTahsilatSatir[]> {
  // Prim veri kaynağı yalnızca İcra Tahsilat modülündeki ödemelerdir.
  if (tahsilatTuruFilter !== 'TUMU' && tahsilatTuruFilter !== 'ICRA') {
    return []
  }

  const { start, end } = monthRange(yil, ay)
  const rows: PersonelTahsilatSatir[] = []

  const icraRows = await prisma.icraTahsilatOdeme.findMany({
    where: {
      tenantId,
      ...tahsilatIcraPersonelWhere(primPersonelId, bagliUserId),
      odemeTarihi: { gte: start, lt: end }
    },
    include: {
      ofisKasaHareket: { select: { onayDurumu: true } },
      alacak: {
        select: {
          durum: true,
          borcluAd: true,
          muvekkil: { select: { gorunenAd: true } },
          dosya: { select: { konuBasligi: true } }
        }
      }
    }
  })
  for (const o of icraRows) {
    if (o.alacak.durum === IcraAlacakDurumEnum.IPTAL) continue
    const onay = (o.ofisKasaHareket?.onayDurumu ?? OfisKasaOnayDurumu.ONAYLI) as TahsilatOnayDurumu
    // İcra tahsilat ödemesi gerçek tahsilattır; ofis kasa onay beklemesi primi engellemez.
    const primHesabinaDahilMi = kaynakRuleEnabled(rule, 'ICRA')
    rows.push({
      id: `icra-${o.id}`,
      kaynak: 'ICRA',
      tarih: o.odemeTarihi.toISOString(),
      tutar: dec(o.tutar),
      aciklama: o.aciklama,
      muvekkilAd: o.alacak.muvekkil?.gorunenAd ?? null,
      dosyaBaslik: o.alacak.dosya?.konuBasligi ?? null,
      kasaTuru: 'İcra tahsilat',
      kaynakKayitId: o.id,
      onayDurumu: onay,
      primHesabinaDahilMi,
      tahsilatiYapanPersonelId: primPersonelId,
      tahsilatiYapanAdSoyad: personelAdSoyad
    })
  }

  return rows.sort((a, b) => b.tarih.localeCompare(a.tarih))
}

async function collectTahsilatlar(
  tenantId: string,
  primPersonelId: string,
  personelAdSoyad: string,
  bagliUserId: string | null,
  yil: number,
  ay: number,
  rule: PrimKuralWithKademeler | null,
  tahsilatTuruFilter: PrimRaporQuery['tahsilatTuru'],
  onlyPrimEligible = false
): Promise<TahsilatSatir[]> {
  const rows = await collectPersonelTahsilatlari(
    tenantId,
    primPersonelId,
    personelAdSoyad,
    bagliUserId,
    yil,
    ay,
    rule,
    tahsilatTuruFilter
  )
  const filtered = onlyPrimEligible ? rows.filter((r) => r.primHesabinaDahilMi) : rows
  return filtered.map(toTahsilatSatir).sort((a, b) => a.tarih.localeCompare(b.tarih))
}

async function listVisiblePrimPersonel(tenantId: string, actorUserId: string, actorRole: UserRole) {
  return prisma.primPersonel.findMany({
    where: {
      tenantId,
      ...(!isYonetici(actorRole) ? { bagliUserId: actorUserId } : {})
    },
    select: { id: true, adSoyad: true, unvan: true, aktifMi: true, bagliUserId: true },
    orderBy: [{ aktifMi: 'desc' }, { adSoyad: 'asc' }]
  })
}

function filterTahsilatlar(
  rows: PersonelTahsilatSatir[],
  query: PersonelPanelDetayQuery
): PersonelTahsilatSatir[] {
  const premiumOnly = !query.includeNonPremium && query.sadecePrimDahil !== false
  return rows.filter((r) => {
    if (query.onayDurumu !== 'TUMU' && r.onayDurumu !== query.onayDurumu) return false
    if (premiumOnly && !r.primHesabinaDahilMi) return false
    return true
  })
}

function buildPersonelOzetFromTahsilatlar(
  rows: PersonelTahsilatSatir[],
  rule: PrimKuralWithKademeler | null,
  primDonem: { id: string; hesaplananPrim: Prisma.Decimal; durum: PrimDonemOdemeDurumu } | null
) {
  const primDahilRows = rows.filter((r) => r.primHesabinaDahilMi)
  const primDahilTahsilat = primDahilRows.reduce((s, t) => s + Number(t.tutar), 0)
  const hesap = rule ? computePremium(primDahilTahsilat, rule.hesaplamaTipi, rule.kademeler) : { toplamPrim: 0, kademeler: [] }
  const tahminiPrim =
    primDonem?.durum === PrimDonemOdemeDurumu.ODENDI
      ? Number(primDonem.hesaplananPrim)
      : hesap.toplamPrim
  const odenmisPrim = primDonem?.durum === PrimDonemOdemeDurumu.ODENDI ? tahminiPrim : 0

  return {
    toplamTahsilatBuAy: primDahilTahsilat.toFixed(2),
    primDahilTahsilat: primDahilTahsilat.toFixed(2),
    tahminiPrim: tahminiPrim.toFixed(2),
    odenmisPrim: odenmisPrim.toFixed(2),
    tahsilatAdedi: primDahilRows.length,
    primDahilTahsilatAdedi: primDahilRows.length,
    kademeHesabi: hesap.kademeler,
    primDonemId: primDonem?.id ?? null,
    primDonemDurum: primDonem?.durum ?? null
  }
}

export async function listPersonelPrimOzet(
  tenantId: string,
  actorUserId: string,
  actorRole: UserRole,
  query: PersonelPanelOzetQuery
) {
  const personeller = await listVisiblePrimPersonel(tenantId, actorUserId, actorRole)
  const primDonemRows = await prisma.primDonemOdemesi.findMany({
    where: {
      tenantId,
      yil: query.yil,
      ay: query.ay,
      primPersonelId: { in: personeller.map((p) => p.id) }
    }
  })
  const primMap = new Map(primDonemRows.map((r) => [r.primPersonelId, r]))

  const items = []
  for (const personel of personeller) {
    const rule = await resolvePrimKuraliForPersonel(tenantId, personel.id)
    const allRows = await collectPersonelTahsilatlari(
      tenantId,
      personel.id,
      personel.adSoyad,
      personel.bagliUserId,
      query.yil,
      query.ay,
      rule,
      'TUMU'
    )
    const primDonem = primMap.get(personel.id) ?? null
    const ozet = buildPersonelOzetFromTahsilatlar(allRows, rule, primDonem)

    items.push({
      primPersonelId: personel.id,
      adSoyad: personel.adSoyad,
      unvan: personel.unvan,
      aktifMi: personel.aktifMi,
      toplamTahsilatBuAy: ozet.toplamTahsilatBuAy,
      tahminiPrim: ozet.tahminiPrim,
      primDonemId: ozet.primDonemId,
      primDonemDurum: ozet.primDonemDurum
    })
  }

  return items
}

export async function getPersonelPrimPanel(
  tenantId: string,
  actorUserId: string,
  actorRole: UserRole,
  primPersonelId: string,
  query: PersonelPanelDetayQuery
) {
  const personel = await assertPrimPersonelAccess(tenantId, actorUserId, actorRole, primPersonelId)

  const rule = await resolvePrimKuraliForPersonel(tenantId, primPersonelId)
  const allRows = await collectPersonelTahsilatlari(
    tenantId,
    primPersonelId,
    personel.adSoyad,
    personel.bagliUserId,
    query.yil,
    query.ay,
    rule,
    query.tahsilatTuru
  )
  const filtered = filterTahsilatlar(allRows, query)

  const primDonem = await prisma.primDonemOdemesi.findFirst({
    where: { tenantId, primPersonelId, yil: query.yil, ay: query.ay }
  })

  const ozet = buildPersonelOzetFromTahsilatlar(allRows, rule, primDonem)

  return {
    personel: {
      id: personel.id,
      adSoyad: personel.adSoyad,
      unvan: personel.unvan,
      aktifMi: personel.aktifMi
    },
    ozet: {
      ...ozet,
      yil: query.yil,
      ay: query.ay,
      uygulananKuralAd: rule?.ad ?? null
    },
    kural: rule ? serializeKural(rule) : null,
    tahsilatlar: filtered
  }
}

