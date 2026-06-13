import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/requireAuth.js'
import { loadAuthContext } from '../middleware/loadAuthContext.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  createUserBodySchema,
  listUsersQuerySchema,
  resetUserPasswordBodySchema,
  updateUserBodySchema
} from './users.schemas.js'
import {
  createUserInTenant,
  deactivateUserInTenant,
  getUserForTenant,
  listUsersForTenant,
  resetUserPasswordInTenant,
  serializePublicUser,
  updateUserInTenant
} from './users.service.js'

export const usersRouter = Router()

const idParamSchema = z.object({ id: z.string().uuid('Geçersiz id.') })

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next)
  }
}

usersRouter.get(
  '/',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const query = listUsersQuerySchema.parse({
      q: req.query.q,
      rol: req.query.rol,
      aktifMi: req.query.aktifMi,
      page: req.query.page,
      limit: req.query.limit
    })
    const { items, total } = await listUsersForTenant(tenantId, query)
    res.json({
      ok: true,
      items: items.map((u) => serializePublicUser(u)),
      total,
      page: query.page,
      limit: query.limit
    })
  })
)

usersRouter.post(
  '/',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId
    const actorUserId = req.auth!.sub
    const body = createUserBodySchema.parse(req.body)
    const created = await createUserInTenant(tenantId, actorUserId, body, req)
    res.status(201).json({ ok: true, user: serializePublicUser(created) })
  })
)

usersRouter.get(
  '/:id',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI, UserRole.AVUKAT_YONETICI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const user = await getUserForTenant(tenantId, id)
    if (!user) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' })
      return
    }
    res.json({ ok: true, user: serializePublicUser(user) })
  })
)

usersRouter.put(
  '/:id',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const actorUserId = req.auth!.sub
    const actorRole = req.auth!.role
    const body = updateUserBodySchema.parse(req.body)
    const updated = await updateUserInTenant(tenantId, actorUserId, actorRole, id, body, req)
    res.json({ ok: true, user: serializePublicUser(updated) })
  })
)

usersRouter.post(
  '/:id/reset-password',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const actorUserId = req.auth!.sub
    const body = resetUserPasswordBodySchema.parse(req.body)
    await resetUserPasswordInTenant(tenantId, actorUserId, id, body, req)
    res.json({ ok: true })
  })
)

usersRouter.delete(
  '/:id',
  requireAuth,
  loadAuthContext,
  requireRole(UserRole.BURO_SAHIBI),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const tenantId = req.auth!.tenantId
    const actorUserId = req.auth!.sub
    const updated = await deactivateUserInTenant(tenantId, actorUserId, id, req)
    res.json({ ok: true, user: serializePublicUser(updated) })
  })
)
