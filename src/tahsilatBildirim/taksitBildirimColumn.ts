import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'

/**
 * `otomatik_bildirim_aktif` kolonu migration uygulanana kadar yok olabilir.
 * Uygulanmamış ortamda varsayılan: açık (true) — müvekkil izni yine kapalıdır.
 */
let cachedHasColumn: boolean | null = null

export async function hasTaksitOtomatikBildirimColumn(): Promise<boolean> {
  if (cachedHasColumn != null) return cachedHasColumn
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'vekalet_taksiti'
        AND column_name = 'otomatik_bildirim_aktif'
    ) AS "exists"
  `
  cachedHasColumn = Boolean(rows[0]?.exists)
  return cachedHasColumn
}

/** Test / process yeniden başlatınca cache temizlenebilir. */
export function resetTaksitBildirimColumnCache(): void {
  cachedHasColumn = null
}

export async function getTaksitOtomatikBildirimAktif(taksitId: string): Promise<boolean> {
  if (!(await hasTaksitOtomatikBildirimColumn())) return true
  const rows = await prisma.$queryRaw<{ otomatik_bildirim_aktif: boolean }[]>`
    SELECT otomatik_bildirim_aktif FROM vekalet_taksiti WHERE id = ${taksitId}::uuid LIMIT 1
  `
  return rows[0]?.otomatik_bildirim_aktif ?? true
}

export async function setTaksitOtomatikBildirimAktif(
  taksitId: string,
  aktif: boolean
): Promise<void> {
  if (!(await hasTaksitOtomatikBildirimColumn())) {
    throw new AppError(
      503,
      'Taksit hatırlatma ayarı için veritabanı güncellemesi gerekir. Migration henüz uygulanmadı.',
      'MIGRATION_REQUIRED'
    )
  }
  await prisma.$executeRaw`
    UPDATE vekalet_taksiti
    SET otomatik_bildirim_aktif = ${aktif}
    WHERE id = ${taksitId}::uuid
  `
}

export async function mapTaksitOtomatikBildirimAktif(
  taksitIds: string[]
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>()
  if (taksitIds.length === 0) return map
  if (!(await hasTaksitOtomatikBildirimColumn())) {
    for (const id of taksitIds) map.set(id, true)
    return map
  }
  const rows = await prisma.$queryRaw<{ id: string; otomatik_bildirim_aktif: boolean }[]>`
    SELECT id, otomatik_bildirim_aktif
    FROM vekalet_taksiti
    WHERE id IN (${Prisma.join(taksitIds)})
  `
  for (const r of rows) map.set(r.id, r.otomatik_bildirim_aktif)
  for (const id of taksitIds) {
    if (!map.has(id)) map.set(id, true)
  }
  return map
}
