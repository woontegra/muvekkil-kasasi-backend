import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import multer from 'multer'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { loadAuthContext } from '../middleware/loadAuthContext.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { AppError } from '../middleware/errorHandler.js'
import { runDesktopImportPreview } from './desktopImportPreview.js'
import { runDesktopImportCommit } from './desktopImportCommit.js'

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, os.tmpdir())
    },
    filename: (_req, _file, cb) => {
      cb(null, `mkd-desktop-import-${randomUUID()}.sqlite`)
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname ?? '').toLowerCase()
    if (!name.endsWith('.sqlite')) {
      cb(new AppError(400, 'Yalnızca .sqlite dosyası yüklenebilir.', 'INVALID_EXTENSION'))
      return
    }
    cb(null, true)
  }
})

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

const commitBodySchema = z.object({
  importBatchId: z.string().uuid('Geçersiz import batch id.')
})

export const desktopImportRouter = Router()

desktopImportRouter.post(
  '/preview',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI),
  (req, res, next) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        next(err instanceof Error ? err : new Error(String(err)))
        return
      }
      next()
    })
  },
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const userId = req.user!.id
    const f = req.file
    if (!f?.path) {
      throw new AppError(400, 'Dosya yükleyin (file alanı).', 'FILE_REQUIRED')
    }
    try {
      const result = await runDesktopImportPreview({
        tenantId,
        userId,
        filePath: f.path,
        originalName: f.originalname || path.basename(f.path),
        req
      })
      res.status(200).json({ ok: true, ...result })
    } finally {
      try {
        fs.unlinkSync(f.path)
      } catch {
        /* ignore */
      }
    }
  })
)

desktopImportRouter.post(
  '/commit',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI),
  (req, res, next) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        next(err instanceof Error ? err : new Error(String(err)))
        return
      }
      next()
    })
  },
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const userId = req.user!.id
    const f = req.file
    if (!f?.path) {
      throw new AppError(400, 'Dosya yükleyin (file alanı).', 'FILE_REQUIRED')
    }
    const rawId = (req.body?.importBatchId as string | undefined) ?? ''
    const parsed = commitBodySchema.safeParse({ importBatchId: rawId.trim() })
    if (!parsed.success) {
      throw new AppError(400, parsed.error.flatten().formErrors.join(' '), 'VALIDATION')
    }
    const { importBatchId } = parsed.data
    try {
      const result = await runDesktopImportCommit({
        tenantId,
        userId,
        importBatchId,
        filePath: f.path,
        originalName: f.originalname || path.basename(f.path),
        req
      })
      res.status(200).json({ ok: true, ...result })
    } finally {
      try {
        fs.unlinkSync(f.path)
      } catch {
        /* ignore */
      }
    }
  })
)
