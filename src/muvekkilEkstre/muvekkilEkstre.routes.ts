import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  assertDosyaAccessible,
  buildMuvekkilEkstreForDosya,
  requireDosyaOrThrow
} from './muvekkilEkstre.service.js'

export const muvekkilEkstreRouter = Router({ mergeParams: true })

const EKSTRE_ROLLER = [UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI, UserRole.KATIP_PERSONEL] as const

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

const dosyaIdSchema = z.object({ id: z.string().uuid('Geçersiz dosya id.') })

const ekstreQuerySchema = z.object({
  itibariyleTarih: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
})

/** GET /dosyalar/:id/muvekkil-ekstresi */
muvekkilEkstreRouter.get(
  '/',
  requireAuth,
  requireRole(...EKSTRE_ROLLER),
  asyncHandler(async (req, res) => {
    const { id: dosyaId } = dosyaIdSchema.parse(req.params)
    const q = ekstreQuerySchema.parse(req.query)
    const tenantId = req.auth!.tenantId
    requireDosyaOrThrow(await assertDosyaAccessible(tenantId, dosyaId))
    const ekstre = await buildMuvekkilEkstreForDosya(tenantId, dosyaId, {
      itibariyleTarih: q.itibariyleTarih
    })
    if (!ekstre) {
      res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Dosya bulunamadı.' })
      return
    }
    res.json({ ok: true, ekstre })
  })
)
