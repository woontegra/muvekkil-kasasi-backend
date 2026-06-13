import { ImportBatchStatus } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'

export async function assertNoCommittedDuplicate(tenantId: string, fingerprint: string): Promise<void> {
  const dup = await prisma.importBatch.findFirst({
    where: { tenantId, sourceFingerprint: fingerprint, status: ImportBatchStatus.COMMITTED }
  })
  if (dup) {
    throw new AppError(409, 'Bu yedek daha önce içe aktarılmış.', 'IMPORT_DUPLICATE')
  }
}
