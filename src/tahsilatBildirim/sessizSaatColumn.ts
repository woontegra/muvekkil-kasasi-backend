import { prisma } from '../lib/prisma.js'

/**
 * `sessiz_saatleri_dikkate_al` migration uygulanana kadar yok olabilir.
 * Prisma Client alanı bilse bile SELECT/CREATE bu kolon olmadan patlamamalı.
 */
let cachedHasColumn: boolean | null = null

export async function hasSessizSaatleriDikkateAlColumn(): Promise<boolean> {
  if (cachedHasColumn != null) return cachedHasColumn
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tahsilat_bildirim_ayar'
        AND column_name = 'sessiz_saatleri_dikkate_al'
    ) AS "exists"
  `
  cachedHasColumn = Boolean(rows[0]?.exists)
  return cachedHasColumn
}

export function resetSessizSaatColumnCache(): void {
  cachedHasColumn = null
}

export async function getSessizSaatleriDikkateAl(tenantId: string): Promise<boolean> {
  if (!(await hasSessizSaatleriDikkateAlColumn())) return false
  const rows = await prisma.$queryRaw<{ sessiz_saatleri_dikkate_al: boolean }[]>`
    SELECT sessiz_saatleri_dikkate_al
    FROM tahsilat_bildirim_ayar
    WHERE tenant_id = ${tenantId}
    LIMIT 1
  `
  return Boolean(rows[0]?.sessiz_saatleri_dikkate_al)
}

export async function setSessizSaatleriDikkateAl(tenantId: string, value: boolean): Promise<void> {
  if (!(await hasSessizSaatleriDikkateAlColumn())) {
    throw new Error('SESSIZ_COLUMN_MISSING')
  }
  await prisma.$executeRaw`
    UPDATE tahsilat_bildirim_ayar
    SET sessiz_saatleri_dikkate_al = ${value}
    WHERE tenant_id = ${tenantId}
  `
}
