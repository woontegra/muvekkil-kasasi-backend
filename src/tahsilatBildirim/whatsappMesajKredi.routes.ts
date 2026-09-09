import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import { UserRole, WhatsAppMesajPaketTalepDurum } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { loadAuthContext } from '../middleware/loadAuthContext.js'
import { requireRole } from '../middleware/requireRole.js'
import { getWhatsAppMesajKrediOzet } from './whatsappMesajKredi.service.js'
import { listWhatsAppMesajPaketleri } from './whatsappMesajPaketleri.js'
import {
  createWhatsAppMesajPaketTalebi,
  listBekleyenPackageIds,
  listTenantWhatsAppMesajPaketTalepleri
} from './whatsappMesajPaketTalep.service.js'

/**
 * Tenant WhatsApp mesaj kredi API.
 * Mount: /api/v1/whatsapp-mesaj-kredisi
 * Kredi bakiyesi okuma + paket satın alma talebi.
 * Online Website checkout yok; kredi yalnız admin onay / lisans / manuel ile eklenir.
 */
export const whatsappMesajKrediRouter = Router()

const OKUMA = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL] as const
const YONETICI = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI] as const

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

whatsappMesajKrediRouter.get(
  '/',
  requireAuth,
  loadAuthContext,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const [ozet, bekleyenPackageIds] = await Promise.all([
      getWhatsAppMesajKrediOzet(tenantId),
      listBekleyenPackageIds(tenantId)
    ])
    res.json({
      ok: true,
      ...ozet,
      paketler: listWhatsAppMesajPaketleri(),
      bekleyenPackageIds
    })
  })
)

const talepCreateSchema = z
  .object({
    packageId: z.string().trim().min(1).max(64)
  })
  .strict()

whatsappMesajKrediRouter.get(
  '/talepler',
  requireAuth,
  loadAuthContext,
  requireRole(...OKUMA),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const durumRaw = typeof req.query.durum === 'string' ? req.query.durum : undefined
    const durum =
      durumRaw && Object.values(WhatsAppMesajPaketTalepDurum).includes(durumRaw as WhatsAppMesajPaketTalepDurum)
        ? (durumRaw as WhatsAppMesajPaketTalepDurum)
        : undefined
    const items = await listTenantWhatsAppMesajPaketTalepleri(tenantId, { durum })
    res.json({ ok: true, items })
  })
)

whatsappMesajKrediRouter.post(
  '/talepler',
  requireAuth,
  loadAuthContext,
  requireRole(...YONETICI),
  asyncHandler(async (req, res) => {
    const body = talepCreateSchema.parse(req.body ?? {})
    const { talep, alreadyExists } = await createWhatsAppMesajPaketTalebi({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.sub,
      packageId: body.packageId
    })
    res.status(alreadyExists ? 200 : 201).json({
      ok: true,
      talep,
      alreadyExists,
      message: alreadyExists
        ? 'Bu paket için bekleyen talebiniz zaten var.'
        : 'Satın alma talebiniz oluşturuldu. Ödeme ve onay işlemi sonrasında mesaj hakkınız hesabınıza eklenecektir.'
    })
  })
)
