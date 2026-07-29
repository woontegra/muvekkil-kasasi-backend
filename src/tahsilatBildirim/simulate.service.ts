import type { Request } from 'express'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { ensureTenantBildirimDefaults } from './settings.service.js'
import { planJobsForTenant } from './planner.service.js'
import { processDueJobs, type ProcessDueJobsResult } from './worker.service.js'

export type SimulateSummary = ProcessDueJobsResult & {
  hazirlanacak: number
  tenantId: string
}

/**
 * Bugünkü vadesi gelen işleri test/simülasyon modunda işler.
 * Gerçek WhatsApp çağrısı yapılmaz.
 */
export async function simulateTodaysJobs(
  tenantId: string,
  userId: string,
  req: Request
): Promise<SimulateSummary> {
  await ensureTenantBildirimDefaults(tenantId)
  await planJobsForTenant(tenantId)

  const result = await processDueJobs({
    tenantId,
    simulateOnly: true,
    limit: 100,
    workerId: `simulate-${userId.slice(0, 8)}`
  })

  const meta = getRequestMeta(req)
  await writeAuditLog({
    tenantId,
    userId,
    action: 'TAHSILAT_BILDIRIM_SIMULE_EDILDI',
    entityType: 'TahsilatBildirimIsi',
    meta: {
      processed: result.processed,
      simulasyon: result.simulasyon,
      atlananTelefon: result.atlananTelefon,
      atlananIzin: result.atlananIzin,
      atlananDosya: result.atlananDosya
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  })

  return {
    ...result,
    hazirlanacak: result.processed,
    tenantId
  }
}
