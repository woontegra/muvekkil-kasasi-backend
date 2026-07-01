import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { generateSaasLicenseKey } from '../lib/saasLicenseKey.js'

type DbClient = Prisma.TransactionClient | typeof prisma

const MAX_ATTEMPTS = 12

export async function allocateUniqueSaasLicenseKey(db: DbClient = prisma): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = generateSaasLicenseKey()
    const existing = await db.tenant.findFirst({
      where: { lisansAnahtari: candidate },
      select: { id: true }
    })
    if (!existing) return candidate
  }
  throw new Error('SaaS lisans anahtarı üretilemedi (çakışma).')
}
