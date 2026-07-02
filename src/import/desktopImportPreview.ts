import type { Request } from 'express'
import { ImportBatchSourceType, ImportBatchStatus, Prisma } from '@prisma/client'
import { assertNoCommittedDuplicate } from './importDuplicateGuard.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import {
  assertWhitelistTablesPresent,
  countRows,
  DESKTOP_IMPORT_TABLES,
  isLikelySqliteFile,
  openDesktopSqliteReadonly,
  selectAllRows
} from './desktopSqlite.js'
import { pickStr } from './desktopImportMappers.js'
import { validateDesktopRows } from './desktopImportValidate.js'
import { sha256File } from './fileFingerprint.js'

export type ImportJsonCounts = Record<string, number>

function buildCounts(db: import('better-sqlite3').Database): ImportJsonCounts {
  const o: ImportJsonCounts = {}
  for (const t of DESKTOP_IMPORT_TABLES) {
    o[t] = countRows(db, t)
  }
  return o
}

function staticPreviewWarnings(): string[] {
  return [
    'Masaüstünde tanımlı müvekkil ek alanları (mudur, muhasebe vb.) SaaS\'ta yoksa boş aktarılır.',
    'Belge numarası boş olan kayıtlar aktarım sırasında otomatik benzersiz numarayla oluşturulur; çakışma sayılmaz.',
    'Mevcut SaaS kayıtlarıyla aynı belge numarası varsa aktarım sırasında yeni numara üretilir.',
    'Avukat adı, baro bilgisi ve logo gibi bazı ofis ayarlarının SaaS karşılığı yoktur.'
  ]
}

async function collectBelgeOverlapWarnings(
  tenantId: string,
  kasaRows: Record<string, unknown>[],
  ofisRows: Record<string, unknown>[]
): Promise<string[]> {
  const wanted = new Set<string>()
  for (const r of kasaRows) {
    const b = pickStr(r, 'belge_no', 'belgeNo', 'belge')?.trim()
    if (b) wanted.add(b)
  }
  for (const r of ofisRows) {
    const b = pickStr(r, 'belge_no', 'belgeNo', 'belge')?.trim()
    if (b) wanted.add(b)
  }
  if (wanted.size === 0) return []
  const arr = [...wanted]
  const [kHit, oHit] = await Promise.all([
    prisma.kasaHareketi.findMany({
      where: { tenantId, belgeNo: { in: arr } },
      select: { belgeNo: true },
      take: 20
    }),
    prisma.ofisKasaHareketi.findMany({
      where: { tenantId, belgeNo: { in: arr } },
      select: { belgeNo: true },
      take: 20
    })
  ])
  const hits = [...kHit, ...oHit].map((x) => x.belgeNo)
  if (!hits.length) return []
  const shown = hits.slice(0, 5).join(', ')
  const more = hits.length > 5 ? ` (+${hits.length - 5} kayıt daha)` : ''
  return [
    `Mevcut büronuzda aynı belge numaralı kayıtlar var; aktarım sırasında yeni numara üretilecek: ${shown}${more}.`
  ]
}

export type DesktopPreviewResult = {
  importBatchId: string
  sourceFingerprint: string
  counts: ImportJsonCounts
  warnings: string[]
  errors: string[]
  canCommit: boolean
}

export async function runDesktopImportPreview(params: {
  tenantId: string
  userId: string
  filePath: string
  originalName: string
  req: Request
}): Promise<DesktopPreviewResult> {
  const { tenantId, userId, filePath, originalName, req } = params
  const meta = getRequestMeta(req)

  if (!isLikelySqliteFile(filePath)) {
    throw new AppError(400, 'Yüklenen dosya geçerli bir SQLite veritabanı değil.', 'INVALID_SQLITE')
  }

  const sourceFingerprint = sha256File(filePath)
  await assertNoCommittedDuplicate(tenantId, sourceFingerprint)

  const db = openDesktopSqliteReadonly(filePath)
  try {
    const missing = assertWhitelistTablesPresent(db)
    if (missing.length) {
      throw new AppError(
        422,
        `Yedek şeması eksik: şu tablolar bulunamadı: ${missing.join(', ')}`,
        'IMPORT_SCHEMA_MISSING'
      )
    }

    const counts = buildCounts(db)
    const muvekkilRows = selectAllRows(db, 'muvekkil')
    const dosyaRows = selectAllRows(db, 'dosya')
    const kasaRows = selectAllRows(db, 'dosya_kasa_hareket')
    const vekaletRows = selectAllRows(db, 'anlasilan_vekalet_ucreti')
    const taksitRows = selectAllRows(db, 'vekalet_ucreti_taksit')
    const ofisRows = selectAllRows(db, 'ofis_kasa_hareketleri')

    const valErrors = validateDesktopRows(muvekkilRows, dosyaRows, kasaRows, vekaletRows, taksitRows)
    const overlapWarnings = await collectBelgeOverlapWarnings(tenantId, kasaRows, ofisRows)
    const warnings = [...staticPreviewWarnings(), ...overlapWarnings]
    const errors = [...valErrors]
    const canCommit = errors.length === 0

    const batch = await prisma.importBatch.create({
      data: {
        tenantId,
        sourceType: ImportBatchSourceType.DESKTOP_SQLITE,
        sourceFingerprint,
        fileName: originalName,
        status: ImportBatchStatus.PREVIEWED,
        rowCounts: counts as Prisma.InputJsonValue,
        warnings: warnings as Prisma.InputJsonValue,
        errors: (errors.length ? errors : null) as Prisma.InputJsonValue | undefined
      }
    })

    await writeAuditLog({
      tenantId,
      userId,
      action: 'DESKTOP_IMPORT_PREVIEWED',
      entityType: 'ImportBatch',
      entityId: batch.id,
      newValue: { sourceFingerprint, counts, canCommit },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })

    return {
      importBatchId: batch.id,
      sourceFingerprint,
      counts,
      warnings,
      errors,
      canCommit
    }
  } finally {
    db.close()
  }
}
