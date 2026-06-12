import type { AuthUserPayload } from './authPayload.js'
import type { Tenant, User } from '@prisma/client'

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUserPayload
      tenantId?: string
      user?: User & { tenant: Tenant }
      tenant?: Tenant
    }
  }
}

export {}
