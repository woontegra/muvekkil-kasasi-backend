import { Prisma } from '@prisma/client'
import { BackupTenantError } from '../backupErrors.js'
import { BACKUP_TABLES } from '../backupTables.js'

export type RestoreForeignKey = {
  model: string
  field: string
  parent: string
}

const backupModels = new Set(BACKUP_TABLES.map((spec) => spec.model))

function backupModel(name: string) {
  const model = Prisma.dmmf.datamodel.models.find((item) => item.name === name)
  if (!model || !backupModels.has(name)) {
    throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
  }
  return model
}

function foreignKeysFrom(modelName: string): RestoreForeignKey[] {
  const keys: RestoreForeignKey[] = []
  for (const field of backupModel(modelName).fields) {
    if (!field.relationFromFields?.length) continue
    if (!backupModels.has(field.type)) {
      throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
    }
    if (field.relationFromFields.length !== 1) {
      throw new BackupTenantError('RESTORE_FK_CYCLE', 'restore')
    }
    keys.push({ model: modelName, field: field.relationFromFields[0]!, parent: field.type })
  }
  return keys
}

export function restoreForeignKeys(): RestoreForeignKey[] {
  const keys: RestoreForeignKey[] = []
  for (const spec of BACKUP_TABLES) keys.push(...foreignKeysFrom(spec.model))
  return keys
}

export function selfReferenceField(modelName: string): string | null {
  const fields = foreignKeysFrom(modelName)
    .filter((key) => key.parent === modelName)
    .map((key) => key.field)
  if (fields.length > 1) throw new BackupTenantError('RESTORE_FK_CYCLE', 'restore')
  return fields[0] ?? null
}

export function restoreInsertOrder(): string[] {
  const indegree = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const spec of BACKUP_TABLES) {
    indegree.set(spec.model, 0)
    children.set(spec.model, [])
  }
  for (const spec of BACKUP_TABLES) {
    const parents = new Set(
      foreignKeysFrom(spec.model)
        .map((key) => key.parent)
        .filter((parent) => parent !== spec.model)
    )
    for (const parent of parents) {
      children.get(parent)?.push(spec.model)
      indegree.set(spec.model, (indegree.get(spec.model) ?? 0) + 1)
    }
  }
  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([name]) => name)
    .sort()
  const order: string[] = []
  while (queue.length > 0) {
    const name = queue.shift()!
    order.push(name)
    for (const child of [...(children.get(name) ?? [])].sort()) {
      const next = (indegree.get(child) ?? 0) - 1
      indegree.set(child, next)
      if (next === 0) queue.push(child)
    }
    queue.sort()
  }
  if (order.length !== BACKUP_TABLES.length) {
    throw new BackupTenantError('RESTORE_FK_CYCLE', 'restore')
  }
  return order
}

export function restoreDeleteOrder(): string[] {
  return [...restoreInsertOrder()].reverse().filter((model) => model !== 'Tenant' && model !== 'User')
}

export function delegateForModel(model: string): string {
  const spec = BACKUP_TABLES.find((item) => item.model === model)
  if (!spec) throw new BackupTenantError('RESTORE_MODEL_FORBIDDEN', 'restore')
  return spec.delegate
}

export function orderRestoreRows(modelName: string, rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const field = selfReferenceField(modelName)
  if (!field) return [...rows]
  const byId = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const id = row.id
    if (typeof id !== 'string' || byId.has(id)) throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'restore')
    byId.set(id, row)
  }
  const indegree = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const id of byId.keys()) {
    indegree.set(id, 0)
    children.set(id, [])
  }
  for (const [id, row] of byId) {
    const parent = row[field]
    if (parent == null) continue
    if (typeof parent !== 'string' || parent === id || !byId.has(parent)) {
      throw new BackupTenantError(parent === id ? 'RESTORE_ROW_CYCLE' : 'RESTORE_FOREIGN_REFERENCE', 'restore')
    }
    children.get(parent)?.push(id)
    indegree.set(id, (indegree.get(id) ?? 0) + 1)
  }
  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort()
  const ordered: Record<string, unknown>[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    const row = byId.get(id)
    if (!row) throw new BackupTenantError('RESTORE_PAYLOAD_INVALID', 'restore')
    ordered.push(row)
    for (const child of [...(children.get(id) ?? [])].sort()) {
      const next = (indegree.get(child) ?? 0) - 1
      indegree.set(child, next)
      if (next === 0) queue.push(child)
    }
    queue.sort()
  }
  if (ordered.length !== rows.length) throw new BackupTenantError('RESTORE_ROW_CYCLE', 'restore')
  return ordered
}
