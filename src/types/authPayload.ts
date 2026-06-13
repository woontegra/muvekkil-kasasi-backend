import type { UserRole } from '@prisma/client'

/** JWT içeriği — masaüstü oturum alanlarıyla uyumlu isimler (kullaniciAdi). */
export type AuthUserPayload = {
  sub: string
  tenantId: string
  role: UserRole
  kullaniciAdi: string
}
