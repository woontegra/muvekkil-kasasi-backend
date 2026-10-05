import { Prisma } from '@prisma/client'
import { BackupTenantError } from '../backupErrors.js'
import { BACKUP_TABLES } from '../backupTables.js'

type ScalarField = {
  name: string
  kind: string
  type: string
  isRequired: boolean
  hasDefaultValue: boolean
  isId: boolean
}

function scalarFields(modelName: string): ScalarField[] {
  const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName)
  const spec = BACKUP_TABLES.find((item) => item.model === modelName)
  if (!model || !spec) throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
  return model.fields.filter((field) => field.kind === 'scalar' || field.kind === 'enum')
}

function coerceValue(field: ScalarField, value: unknown): unknown {
  if (value == null) {
    if (field.isRequired) throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'restore')
    return null
  }
  if (field.kind === 'enum') {
    if (typeof value !== 'string') throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'restore')
    return value
  }
  if (field.type === 'Decimal') return new Prisma.Decimal(String(value))
  if (field.type === 'DateTime') {
    if (typeof value !== 'string') throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'restore')
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'restore')
    return date
  }
  if (field.type === 'BigInt') return BigInt(String(value))
  if (field.type === 'Int' || field.type === 'Float') {
    if (typeof value !== 'number') throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'restore')
    return value
  }
  if (field.type === 'Boolean') {
    if (typeof value !== 'boolean') throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'restore')
    return value
  }
  if (field.type === 'String' || field.type === 'Json') return value
  throw new BackupTenantError('RESTORE_SCHEMA_MISMATCH', 'restore')
}

export function coerceRestoreRow(
  modelName: string,
  row: Record<string, unknown>,
  mode: 'create' | 'update'
): Record<string, unknown> {
  const fields = scalarFields(modelName)
  const known = new Set(fields.map((field) => field.name))
  for (const key of Object.keys(row)) {
    if (!known.has(key)) throw new BackupTenantError('RESTORE_SCHEMA_MISMATCH', 'restore')
  }
  const data: Record<string, unknown> = {}
  for (const field of fields) {
    if (mode === 'update' && (field.isId || field.name === 'id' || field.name === 'tenantId')) continue
    if (!(field.name in row)) {
      if (mode === 'create' && field.isRequired && !field.hasDefaultValue) {
        throw new BackupTenantError('RESTORE_SCHEMA_MISMATCH', 'restore')
      }
      continue
    }
    data[field.name] = coerceValue(field, row[field.name])
  }
  return data
}
