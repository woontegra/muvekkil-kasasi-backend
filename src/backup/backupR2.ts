import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { BackupTenantError } from './backupErrors.js'
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
