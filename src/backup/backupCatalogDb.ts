import { prisma } from '../lib/prisma.js'
import { loadBackupListEnv } from './backupEnv.js'
import {
  backupCatalogWhere,
  createBackupCatalogLoader,
  type BackupCatalogQuery,
  type CatalogTenantRow
} from './backupCatalog.js'
import { createR2BackupStore } from './backupR2.js'

const ownerSelect = {
  where: { role: 'BURO_SAHIBI' as const },
  orderBy: { createdAt: 'asc' as const },
  take: 1,
  select: {
    adSoyad: true,
    kullaniciAdi: true,
    eposta: true
  }
}

function toRow(row: {
  id: string
  buroAdi: string
  eposta: string | null
  lisansDurumu: string
  demoMu: boolean
  users: { adSoyad: string; kullaniciAdi: string; eposta: string | null }[]
}): CatalogTenantRow {
  const owner = row.users[0] ?? null
  return {
    tenantId: row.id,
    buroAdi: row.buroAdi,
    kullaniciAdi: owner?.kullaniciAdi ?? null,
    sahipAdSoyad: owner?.adSoyad ?? null,
    eposta: row.eposta ?? owner?.eposta ?? null,
    lisansDurumu: row.lisansDurumu,
    demoMu: row.demoMu
  }
}

const loader = createBackupCatalogLoader({
  listHeads: async () => {
    const cfg = loadBackupListEnv(process.env)
    return createR2BackupStore(cfg).listObjectHeads('tenants/')
  },
  readEligibleIds: async () => {
    const rows = await prisma.tenant.findMany({
      where: backupCatalogWhere(),
      select: { id: true }
    })
    return rows.map((row) => row.id)
  },
  readPage: async (query) => {
    const where = backupCatalogWhere(query.q)
    const [total, rows] = await Promise.all([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        orderBy: [{ buroAdi: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          buroAdi: true,
          eposta: true,
          lisansDurumu: true,
          demoMu: true,
          users: ownerSelect
        }
      })
    ])
    return { total, rows: rows.map(toRow) }
  }
})

export function clearBackupCatalogCache(): void {
  loader.clear()
}

export function getBackupCatalog(query: BackupCatalogQuery) {
  return loader.load(query)
}
