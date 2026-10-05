import type { Prisma } from '@prisma/client'
import { BACKUP_OBJECT_KEY_RE } from './backupObjectKey.js'
import type { BackupObjectHead } from './backupStore.js'
import { shouldBackupTenant } from './backupTables.js'

const DEFAULT_TTL_MS = 60_000

export type BackupCatalogQuery = {
  q?: string
  page: number
  limit: number
}

export type CatalogTenantRow = {
  tenantId: string
  buroAdi: string
  kullaniciAdi: string | null
  sahipAdSoyad: string | null
  eposta: string | null
  lisansDurumu: string
  demoMu: boolean
}

export type BackupCatalogStatus = 'YOK' | 'BASARILI' | 'EKSIK'

export type BackupCatalogItem = {
  tenantId: string
  buroAdi: string
  kullaniciAdi: string | null
  sahipAdSoyad: string | null
  eposta: string | null
  lisansDurumu: string
  backupCount: number
  oldestBackupDate: string | null
  lastSuccessfulBackupDate: string | null
  lastBackupStatus: BackupCatalogStatus
}

export type BackupCatalogSummary = {
  eligibleCount: number
  lastRunAt: string | null
  lastRunDate: string | null
  successCount: number
  failedCount: number
}

export type BackupCatalogPage = {
  summary: BackupCatalogSummary
  items: BackupCatalogItem[]
  total: number
  page: number
  limit: number
}

type DayFiles = {
  snapshot: boolean
  manifest: boolean
  lastModified: string | null
}

export type BackupIndex = Map<string, Map<string, DayFiles>>

const NOT_DEMO: Prisma.TenantWhereInput = {
  NOT: {
    OR: [{ demoMu: true }, { lisansDurumu: 'DEMO' }]
  }
}

/** Demo ve DEMO lisans hariç. PASIF ve SURESI_DOLDU dahildir. */
export function backupCatalogWhere(q?: string): Prisma.TenantWhereInput {
  const where: Prisma.TenantWhereInput = { ...NOT_DEMO }
  const term = q?.trim()
  if (!term) return where
  where.AND = [
    {
      OR: [
        { buroAdi: { contains: term, mode: 'insensitive' } },
        { eposta: { contains: term, mode: 'insensitive' } },
        { id: { contains: term, mode: 'insensitive' } },
        {
          users: {
            some: {
              role: 'BURO_SAHIBI',
              OR: [
                { adSoyad: { contains: term, mode: 'insensitive' } },
                { eposta: { contains: term, mode: 'insensitive' } },
                { kullaniciAdi: { contains: term, mode: 'insensitive' } }
              ]
            }
          }
        }
      ]
    }
  ]
  return where
}

export function matchesBackupCatalogQuery(row: CatalogTenantRow, q?: string): boolean {
  if (!shouldBackupTenant(row)) return false
  const term = q?.trim().toLowerCase()
  if (!term) return true
  const haystack = [row.buroAdi, row.eposta, row.tenantId, row.kullaniciAdi, row.sahipAdSoyad]
  return haystack.some((value) => (value ?? '').toLowerCase().includes(term))
}

export function buildBackupIndex(heads: readonly BackupObjectHead[]): BackupIndex {
  const index: BackupIndex = new Map()
  for (const head of heads) {
    const match = BACKUP_OBJECT_KEY_RE.exec(head.key)
    if (!match) continue
    const tenantId = match[1].toLowerCase()
    const date = match[2]
    const kind = match[3].toLowerCase()
    let days = index.get(tenantId)
    if (!days) {
      days = new Map()
      index.set(tenantId, days)
    }
    let day = days.get(date)
    if (!day) {
      day = { snapshot: false, manifest: false, lastModified: null }
      days.set(date, day)
    }
    if (kind.startsWith('snapshot')) day.snapshot = true
    else day.manifest = true
    if (head.lastModified && (!day.lastModified || head.lastModified > day.lastModified)) {
      day.lastModified = head.lastModified
    }
  }
  return index
}

export function presenceFor(index: BackupIndex, tenantId: string) {
  const days = index.get(tenantId.toLowerCase())
  if (!days || days.size === 0) {
    return {
      backupCount: 0,
      oldestBackupDate: null,
      lastSuccessfulBackupDate: null,
      lastBackupStatus: 'YOK' as const,
      lastObjectAt: null
    }
  }
  const dates = [...days.keys()].sort()
  const newest = dates[dates.length - 1]
  const newestDay = days.get(newest)
  let lastSuccessfulBackupDate: string | null = null
  for (const date of dates) {
    if (days.get(date)?.manifest) lastSuccessfulBackupDate = date
  }
  const lastBackupStatus: BackupCatalogStatus =
    newestDay?.snapshot && newestDay.manifest ? 'BASARILI' : 'EKSIK'
  return {
    backupCount: dates.length,
    oldestBackupDate: dates[0] ?? null,
    lastSuccessfulBackupDate,
    lastBackupStatus,
    lastObjectAt: newestDay?.lastModified ?? null
  }
}

export function summarizeBackupRun(
  eligibleIds: readonly string[],
  index: BackupIndex
): BackupCatalogSummary {
  const unique = [...new Set(eligibleIds.map((id) => id.toLowerCase()))]
  let lastRunDate: string | null = null
  for (const id of unique) {
    const days = index.get(id)
    if (!days) continue
    for (const date of days.keys()) {
      if (!lastRunDate || date > lastRunDate) lastRunDate = date
    }
  }
  if (!lastRunDate) {
    return {
      eligibleCount: unique.length,
      lastRunAt: null,
      lastRunDate: null,
      successCount: 0,
      failedCount: 0
    }
  }
  let successCount = 0
  let lastRunAt: string | null = null
  for (const id of unique) {
    const day = index.get(id)?.get(lastRunDate)
    if (day?.manifest) successCount += 1
    if (day?.lastModified && (!lastRunAt || day.lastModified > lastRunAt)) {
      lastRunAt = day.lastModified
    }
  }
  return {
    eligibleCount: unique.length,
    lastRunAt,
    lastRunDate,
    successCount,
    failedCount: unique.length - successCount
  }
}

export function buildCatalogResponse(input: {
  rows: readonly CatalogTenantRow[]
  total: number
  page: number
  limit: number
  eligibleIds: readonly string[]
  index: BackupIndex
}): BackupCatalogPage {
  const items = input.rows.filter((row) => shouldBackupTenant(row)).map((row) => {
    const presence = presenceFor(input.index, row.tenantId)
    return {
      tenantId: row.tenantId,
      buroAdi: row.buroAdi,
      kullaniciAdi: row.kullaniciAdi,
      sahipAdSoyad: row.sahipAdSoyad,
      eposta: row.eposta,
      lisansDurumu: row.lisansDurumu,
      backupCount: presence.backupCount,
      oldestBackupDate: presence.oldestBackupDate,
      lastSuccessfulBackupDate: presence.lastSuccessfulBackupDate,
      lastBackupStatus: presence.lastBackupStatus
    }
  })
  return {
    summary: summarizeBackupRun(input.eligibleIds, input.index),
    items,
    total: input.total,
    page: input.page,
    limit: input.limit
  }
}

export type BackupDayView = {
  calendarDate: string
  lastModified: string | null
  status: 'BASARILI' | 'EKSIK'
}

export function backupDaysForTenant(index: BackupIndex, tenantId: string): BackupDayView[] {
  const days = index.get(tenantId.toLowerCase())
  if (!days) return []
  return [...days.entries()]
    .sort((left, right) => (left[0] < right[0] ? 1 : left[0] > right[0] ? -1 : 0))
    .map(([calendarDate, day]) => ({
      calendarDate,
      lastModified: day.lastModified,
      status: day.snapshot && day.manifest ? 'BASARILI' : 'EKSIK'
    }))
}

export function createBackupCatalogLoader(deps: {
  listHeads: () => Promise<BackupObjectHead[]>
  readPage: (query: BackupCatalogQuery) => Promise<{ total: number; rows: CatalogTenantRow[] }>
  readEligibleIds: () => Promise<string[]>
  now?: () => number
  ttlMs?: number
}) {
  let cache: { at: number; heads: BackupObjectHead[] } | null = null
  async function currentIndex(): Promise<BackupIndex> {
    const now = deps.now?.() ?? Date.now()
    const ttl = deps.ttlMs ?? DEFAULT_TTL_MS
    if (!cache || now - cache.at >= ttl) {
      cache = { at: now, heads: await deps.listHeads() }
    }
    return buildBackupIndex(cache.heads)
  }
  return {
    clear(): void {
      cache = null
    },
    objectIndex: currentIndex,
    async load(query: BackupCatalogQuery): Promise<BackupCatalogPage> {
      const index = await currentIndex()
      const [page, eligibleIds] = await Promise.all([deps.readPage(query), deps.readEligibleIds()])
      return buildCatalogResponse({
        rows: page.rows,
        total: page.total,
        page: query.page,
        limit: query.limit,
        eligibleIds,
        index
      })
    }
  }
}
