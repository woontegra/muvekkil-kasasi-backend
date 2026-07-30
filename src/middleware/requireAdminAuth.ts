import type { RequestHandler } from 'express'
import { verifyAdminAccessToken } from '../auth/adminJwt.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from './errorHandler.js'

/**
 * Admin JWT doğrular; ardından SuperAdmin.aktifMi + güncel rolü DB'den yükler.
 * Pasif / silinmiş admin, access token süresi dolmamış olsa bile reddedilir.
 */
export const requireAdminAuth: RequestHandler = (req, _res, next) => {
  const h = req.header('authorization')?.trim()
  if (!h?.toLowerCase().startsWith('bearer ')) {
    return next(new AppError(401, 'Admin oturumu gerekli', 'ADMIN_UNAUTHORIZED'))
  }
  const token = h.slice(7).trim()
  if (!token) {
    return next(new AppError(401, 'Admin oturumu gerekli', 'ADMIN_UNAUTHORIZED'))
  }

  void (async () => {
    try {
      const payload = verifyAdminAccessToken(token)
      const admin = await prisma.superAdmin.findUnique({
        where: { id: payload.sub },
        select: { id: true, aktifMi: true, rol: true, kullaniciAdi: true }
      })
      if (!admin) {
        return next(new AppError(401, 'Admin bulunamadı veya pasif.', 'ADMIN_GONE'))
      }
      if (!admin.aktifMi) {
        return next(new AppError(403, 'Admin hesabı pasif.', 'ADMIN_INACTIVE'))
      }
      req.adminAuth = {
        typ: 'admin',
        sub: admin.id,
        role: admin.rol,
        kullaniciAdi: admin.kullaniciAdi
      }
      next()
    } catch (err) {
      if (err instanceof AppError) return next(err)
      next(new AppError(401, 'Geçersiz veya süresi dolmuş admin oturumu', 'ADMIN_INVALID_TOKEN'))
    }
  })()
}
