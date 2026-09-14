import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  createDovizDonusumBodySchema,
  createOfisKasaDuzeltmeBodySchema,
  createOfisKasaHareketiBodySchema,
  listOfisKasaHareketleriQuerySchema,
  rejectOfisKasaBodySchema
} from './ofisKasa.schemas.js'
import { guvenliMasrafSilBodySchema } from '../kasa/kasa.schemas.js'
import {
  approveOfisKasaHareketi,
  createDovizDonusum,
  createOfisKasaDuzeltme,
  createOfisKasaHareketi,
  deleteDovizDonusum,
  deleteOfisKasaHareketi,
  getOfisKasaOzet,
  getOfisKasaAnaSayfaOzet,
  updateHesapDonemiModu,
  listOfisKasaHareketleri,
  rejectOfisKasaHareketi,
  serializeOfisKasaHareketi
} from './ofisKasa.service.js'
import { guvenliOfisHareketSil } from './ofisGiderGuvenliSil.service.js'
import { AppError } from '../middleware/errorHandler.js'

export const ofisKasasiRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })

const YONETICI_ROLLER = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI] as const
const HAREKET_OLUSTURMA_ROLLER = [
  UserRole.BURO_SAHIBI,
  UserRole.AVUKAT_YONETICI,
  UserRole.KATIP_PERSONEL
] as const

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

ofisKasasiRouter.get(
  '/ozet',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const ozet = await getOfisKasaOzet(tenantId)
    res.json({ ok: true, ozet })
  })
)

ofisKasasiRouter.get(
  '/anasayfa-ozet',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const referenceDate =
      typeof req.query.referenceDate === 'string' ? req.query.referenceDate : undefined
    const ozet = await getOfisKasaAnaSayfaOzet(tenantId, referenceDate)
    res.json({ ok: true, ...ozet })
  })
)

const hesapDonemiModuSchema = z.object({
  hesapDonemiModu: z.enum(['MONTHLY', 'YEARLY'])
})

ofisKasasiRouter.patch(
  '/hesap-donemi-modu',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const { hesapDonemiModu } = hesapDonemiModuSchema.parse(req.body)
    await updateHesapDonemiModu(tenantId, hesapDonemiModu)
    res.json({ ok: true, hesapDonemiModu })
  })
)

ofisKasasiRouter.get(
  '/hareketler',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const query = listOfisKasaHareketleriQuerySchema.parse(req.query)
    const { items, total } = await listOfisKasaHareketleri(tenantId, query)
    res.json({
      ok: true,
      items: items.map((h) => serializeOfisKasaHareketi(h)),
      total,
      page: query.page,
      limit: query.limit
    })
  })
)

ofisKasasiRouter.post(
  '/doviz-donusum',
  requireAuth,
  requireRole(...HAREKET_OLUSTURMA_ROLLER),
  asyncHandler(async (req, res) => {
    const body = createDovizDonusumBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const pair = await createDovizDonusum(tenantId, userId, body, req)
    res.status(201).json({
      ok: true,
      dovizDonusumId: pair.cikis.dovizDonusumId,
      cikis: serializeOfisKasaHareketi({ ...pair.cikis, orijinalHareket: null }),
      giris: serializeOfisKasaHareketi({ ...pair.giris, orijinalHareket: null })
    })
  })
)

const dovizDonusumIdParamSchema = z.object({ dovizDonusumId: z.string().uuid('Geçersiz döviz dönüşüm id.') })

ofisKasasiRouter.delete(
  '/doviz-donusum/:dovizDonusumId',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { dovizDonusumId } = dovizDonusumIdParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    await deleteDovizDonusum(tenantId, userId, dovizDonusumId, req)
    res.status(204).send()
  })
)

ofisKasasiRouter.post(
  '/hareketler',
  requireAuth,
  requireRole(...HAREKET_OLUSTURMA_ROLLER),
  asyncHandler(async (req, res) => {
    const body = createOfisKasaHareketiBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const created = await createOfisKasaHareketi(tenantId, userId, req.auth!.role, body, req)
    const row = await prisma.ofisKasaHareketi.findFirst({
      where: { id: created.id, tenantId },
      include: {
        orijinalHareket: { select: { id: true, belgeNo: true } },
        muvekkil: { select: { id: true, gorunenAd: true, aktifMi: true } },
        tahsilatiYapanPersonel: { select: { id: true, adSoyad: true } },
        createdBy: { select: { id: true, adSoyad: true, kullaniciAdi: true } }
      }
    })
    if (!row) {
      res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Kayıt okunamadı.' })
      return
    }
    res.status(201).json({ ok: true, ofisKasaHareketi: serializeOfisKasaHareketi(row) })
  })
)

ofisKasasiRouter.post(
  '/hareketler/:id/onayla',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const updated = await approveOfisKasaHareketi(tenantId, userId, id, req)
    res.json({ ok: true, ofisKasaHareketi: serializeOfisKasaHareketi({ ...updated, orijinalHareket: null }) })
  })
)

ofisKasasiRouter.post(
  '/hareketler/:id/reddet',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = rejectOfisKasaBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const updated = await rejectOfisKasaHareketi(tenantId, userId, id, body.redSebebi, req)
    res.json({ ok: true, ofisKasaHareketi: serializeOfisKasaHareketi({ ...updated, orijinalHareket: null }) })
  })
)

ofisKasasiRouter.post(
  '/hareketler/:id/duzeltme',
  requireAuth,
  requireRole(...HAREKET_OLUSTURMA_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = createOfisKasaDuzeltmeBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const created = await createOfisKasaDuzeltme(tenantId, userId, id, body, req)
    const row = await prisma.ofisKasaHareketi.findFirst({
      where: { id: created.id, tenantId, deletedAt: null },
      include: { orijinalHareket: { select: { id: true, belgeNo: true } } }
    })
    if (!row) {
      res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Kayıt okunamadı.' })
      return
    }
    res.status(201).json({ ok: true, ofisKasaHareketi: serializeOfisKasaHareketi(row) })
  })
)

/**
 * Güvenli ofis GIDER / GELIR soft-delete veya bağlı tahsilat iptali — yalnız BURO_SAHIBI + şifre.
 */
ofisKasasiRouter.post(
  '/hareketler/:id/guvenli-sil',
  requireAuth,
  requireRole(UserRole.BURO_SAHIBI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = guvenliMasrafSilBodySchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    const actor = await prisma.user.findFirst({
      where: { id: userId, tenantId, aktifMi: true },
      select: { id: true, role: true, adSoyad: true, sifreHash: true }
    })
    if (!actor || actor.role !== UserRole.BURO_SAHIBI) {
      throw new AppError(403, 'Bu işlem yalnızca büro sahibi tarafından yapılabilir.', 'FORBIDDEN')
    }
    const result = await guvenliOfisHareketSil(tenantId, actor, id, body, req)
    const message =
      result.mode === 'TAHSILAT_IPTAL'
        ? result.alreadyDone
          ? 'Tahsilat zaten iptal edilmişti'
          : 'Tahsilat iptal edildi ve denetim kaydı oluşturuldu'
        : result.mode === 'GELIR_SIL'
          ? result.alreadyDone
            ? 'Gelir zaten silinmişti'
            : 'Gelir silindi ve denetim kaydı oluşturuldu'
          : result.alreadyDone
            ? 'Masraf zaten silinmişti'
            : 'Masraf silindi ve denetim kaydı oluşturuldu'
    res.json({
      ok: true,
      message,
      mode: result.mode,
      alreadyDone: result.alreadyDone,
      softDeletedIds: result.softDeletedIds,
      auditMessage: result.auditMessage
    })
  })
)

ofisKasasiRouter.delete(
  '/hareketler/:id',
  requireAuth,
  requireRole(...YONETICI_ROLLER),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const userId = req.auth!.sub
    await deleteOfisKasaHareketi(tenantId, userId, id, req)
    res.status(204).send()
  })
)
