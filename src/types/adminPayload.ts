import type { SuperAdminRole } from '@prisma/client'

/** Admin JWT payload — büro JWT’sinden ayrı (secret veya `typ`). */
export type AdminJwtPayload = {
  typ: 'admin'
  sub: string
  role: SuperAdminRole
  kullaniciAdi: string
}
