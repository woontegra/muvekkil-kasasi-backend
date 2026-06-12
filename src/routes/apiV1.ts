import { Router } from 'express'
import { authRouter } from '../auth/auth.routes.js'
import { loadAuthContext } from '../middleware/loadAuthContext.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requirePermission } from '../middleware/requirePermission.js'
import { tenantContext } from '../middleware/tenantContext.js'
import { Permission } from '../permissions/roles.js'
import { meHandler } from './me.js'

export const apiV1Router = Router()

apiV1Router.use(tenantContext)
apiV1Router.use('/auth', authRouter)

apiV1Router.get('/me', requireAuth, loadAuthContext, meHandler)

/** Örnek korumalı uç — audit okuma yetkisi (iskelet). */
apiV1Router.get('/audit/ping', requireAuth, loadAuthContext, requirePermission(Permission.AUDIT_READ), (_req, res) => {
  res.json({ ok: true, message: 'Audit uçları yakında.' })
})
