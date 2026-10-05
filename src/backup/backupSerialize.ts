import { Prisma } from '@prisma/client'

export function serializeBackupValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Prisma.Decimal.isDecimal(value)) return value.toString()
  if (Array.isArray(value)) return value.map((item) => serializeBackupValue(item))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serializeBackupValue(nested)
    }
    return out
  }
  return String(value)
}

export function serializeBackupRow(row: Record<string, unknown>): Record<string, unknown> {
  return serializeBackupValue(row) as Record<string, unknown>
}
