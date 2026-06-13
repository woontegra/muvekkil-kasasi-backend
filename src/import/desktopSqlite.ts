import fs from 'node:fs'
import Database from 'better-sqlite3'

/** Masaüstü yedeğinde beklenen tablolar (yalnızca whitelist SELECT). */
export const DESKTOP_IMPORT_TABLES = [
  'muvekkil',
  'dosya',
  'dosya_kasa_hareket',
  'anlasilan_vekalet_ucreti',
  'vekalet_ucreti_taksit',
  'ofis_kasa_hareketleri',
  'office_settings'
] as const

export type DesktopImportTable = (typeof DESKTOP_IMPORT_TABLES)[number]

const SQLITE_MAGIC = Buffer.from('SQLite format 3\x00')

export function isLikelySqliteFile(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(16)
    const n = fs.readSync(fd, buf, 0, 16, 0)
    if (n < SQLITE_MAGIC.length) return false
    return buf.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)
  } finally {
    fs.closeSync(fd)
  }
}

export function openDesktopSqliteReadonly(filePath: string): Database.Database {
  if (!isLikelySqliteFile(filePath)) {
    throw new Error('Dosya geçerli bir SQLite veritabanı başlığı içermiyor.')
  }
  return new Database(filePath, { readonly: true, fileMustExist: true })
}

export function listUserTables(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

export function assertWhitelistTablesPresent(db: Database.Database): string[] {
  const names = new Set(listUserTables(db))
  const missing: string[] = []
  for (const t of DESKTOP_IMPORT_TABLES) {
    if (!names.has(t)) missing.push(t)
  }
  return missing
}

export function countRows(db: Database.Database, table: DesktopImportTable): number {
  const stmt = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`)
  const row = stmt.get() as { c: number }
  return Number(row.c)
}

export function selectAllRows(db: Database.Database, table: DesktopImportTable): Record<string, unknown>[] {
  const stmt = db.prepare(`SELECT * FROM "${table}"`)
  return stmt.all() as Record<string, unknown>[]
}
