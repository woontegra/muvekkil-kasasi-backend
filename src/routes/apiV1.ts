import { Router } from 'express'
import { authRouter } from '../auth/auth.routes.js'
import { loadAuthContext } from '../middleware/loadAuthContext.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requirePermission } from '../middleware/requirePermission.js'
import { tenantContext } from '../middleware/tenantContext.js'
import { muvekkillerRouter } from '../muvekkil/muvekkil.routes.js'
import { dosyalarRouter } from '../dosya/dosya.routes.js'
import { kasaHareketleriRouter } from '../kasa/kasa.routes.js'
import { vekaletTaksitleriRouter } from '../vekalet/vekaletTaksit.routes.js'
import { vekaletTaksitOdemeleriRouter } from '../vekalet/vekaletTaksitOdeme.routes.js'
import { ofisKasasiRouter } from '../ofisKasa/ofisKasa.routes.js'
import { dashboardRouter } from '../dashboard/dashboard.routes.js'
import { smmRouter } from '../smm/smm.routes.js'
import { desktopImportRouter } from '../import/desktopImport.routes.js'
import { usersRouter } from '../users/users.routes.js'
import { licenseRouter } from '../license/license.routes.js'
import { Permission } from '../permissions/roles.js'
import { meHandler } from './me.js'
import { adminRouter } from '../admin/admin.routes.js'

export const apiV1Router = Router()

apiV1Router.use('/admin', adminRouter)
apiV1Router.use(tenantContext)
apiV1Router.use('/auth', authRouter)
apiV1Router.use('/muvekkiller', muvekkillerRouter)
apiV1Router.use('/dosyalar', dosyalarRouter)
apiV1Router.use('/kasa-hareketleri', kasaHareketleriRouter)
apiV1Router.use('/vekalet-taksitleri', vekaletTaksitleriRouter)
apiV1Router.use('/vekalet-taksit-odemeleri', vekaletTaksitOdemeleriRouter)
apiV1Router.use('/ofis-kasasi', ofisKasasiRouter)
apiV1Router.use('/dashboard', dashboardRouter)
apiV1Router.use('/smm', smmRouter)
apiV1Router.use('/import/desktop', desktopImportRouter)
apiV1Router.use('/users', usersRouter)
apiV1Router.use('/license', licenseRouter)

apiV1Router.get('/me', requireAuth, loadAuthContext, meHandler)

/** Örnek korumalı uç — audit okuma yetkisi (iskelet). */
apiV1Router.get('/audit/ping', requireAuth, loadAuthContext, requirePermission(Permission.AUDIT_READ), (_req, res) => {
  res.json({ ok: true, message: 'Audit uçları yakında.' })
})
