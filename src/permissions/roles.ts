import { UserRole } from '@prisma/client'

/** Masaüstü iş kurallarına uyum için rol hiyerarşisi (sayı büyük = daha geniş yetki). */
export const roleRank: Record<UserRole, number> = {
  KATIP_PERSONEL: 1,
  AVUKAT_YONETICI: 2,
  BURO_SAHIBI: 3
}

export function hasAtLeastRole(userRole: UserRole, minimum: UserRole): boolean {
  return roleRank[userRole] >= roleRank[minimum]
}

/** İleride ince taneli izinler — şimdilik sabit isimler */
export const Permission = {
  TENANT_MANAGE_USERS: 'tenant:manage_users',
  KASA_APPROVE: 'kasa:approve',
  KASA_EDIT_PENDING: 'kasa:edit_pending',
  AUDIT_READ: 'audit:read'
} as const

export type PermissionKey = (typeof Permission)[keyof typeof Permission]

/** Rol → izin eşlemesi (iskelet) */
export function permissionsForRole(role: UserRole): Set<PermissionKey> {
  const s = new Set<PermissionKey>()
  if (role === UserRole.BURO_SAHIBI) {
    s.add(Permission.TENANT_MANAGE_USERS)
    s.add(Permission.KASA_APPROVE)
    s.add(Permission.KASA_EDIT_PENDING)
    s.add(Permission.AUDIT_READ)
  }
  if (role === UserRole.AVUKAT_YONETICI) {
    s.add(Permission.KASA_APPROVE)
    s.add(Permission.KASA_EDIT_PENDING)
    s.add(Permission.AUDIT_READ)
  }
  if (role === UserRole.KATIP_PERSONEL) {
    s.add(Permission.KASA_EDIT_PENDING)
  }
  return s
}

export function roleHasPermission(role: UserRole, key: PermissionKey): boolean {
  return permissionsForRole(role).has(key)
}
