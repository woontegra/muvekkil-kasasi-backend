import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { BackupTenantError } from './backupErrors.js'
import { BACKUP_OBJECT_KEY_RE } from './backupObjectKey.js'
import { assertObjectUpload, type BackupObjectHead, type BackupObjectStore } from './backupStore.js'

export type R2StoreConfig = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  endpoint: string
}

export type R2BackupStore = BackupObjectStore & {
  listObjectHeads: (prefix: string) => Promise<BackupObjectHead[]>
  getObject: (key: string) => Promise<Buffer | null>
}

export function createR2BackupStore(cfg: R2StoreConfig): R2BackupStore {
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey
    }
  })

  return {
    async putObject(key, body, contentType) {
      assertObjectUpload(key, body)
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType
        })
      )
    },
    async listKeys(prefix) {
      const keys: string[] = []
      let token: string | undefined
      do {
        const out = await client.send(
          new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: prefix,
            ContinuationToken: token
          })
        )
        for (const obj of out.Contents ?? []) {
          if (obj.Key) keys.push(obj.Key)
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined
      } while (token)
      return keys
    },
    async listObjectHeads(prefix) {
      if (!prefix.startsWith('tenants/') || prefix.includes('@')) {
        throw new BackupTenantError('LIST_PREFIX_INVALID', 'list')
      }
      const heads: BackupObjectHead[] = []
      let token: string | undefined
      do {
        const out = await client.send(
          new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: prefix,
            ContinuationToken: token
          })
        )
        for (const obj of out.Contents ?? []) {
          if (!obj.Key) continue
          heads.push({
            key: obj.Key,
            lastModified: obj.LastModified ? obj.LastModified.toISOString() : null
          })
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined
      } while (token)
      return heads
    },
    async getObject(key) {
      if (!BACKUP_OBJECT_KEY_RE.test(key) || key.includes('@') || key.includes('..')) {
        throw new BackupTenantError('OBJECT_KEY_REJECTED', 'get')
      }
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }))
        if (!out.Body) return null
        const bytes = await out.Body.transformToByteArray()
        return Buffer.from(bytes)
      } catch (err) {
        if (isMissingObject(err)) return null
        throw new BackupTenantError('RESTORE_OBJECT_READ_FAILED', 'get')
      }
    },
    async deleteKeys(keys) {
      if (keys.length === 0) return
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000)
        const out = await client.send(
          new DeleteObjectsCommand({
            Bucket: cfg.bucket,
            Delete: {
              Objects: batch.map((Key) => ({ Key })),
              Quiet: true
            }
          })
        )
        if (out.Errors && out.Errors.length > 0) {
          throw new BackupTenantError('RETENTION_DELETE_FAILED', 'retention')
        }
      }
    }
  }
}

function isMissingObject(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = 'name' in err ? String((err as { name: unknown }).name) : ''
  if (name === 'NoSuchKey' || name === 'NotFound') return true
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
  return status === 404
}
