import { BildirimIsDurumu } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { getSmsProvider } from './providers/smsProvider.js'
import { refundSmsCredit } from './smsWallet.service.js'

export async function processSmsReportWorker(limit = 100): Promise<{ checked: number; delivered: number; failed: number; waiting: number }> {
  const now = new Date()
  const jobs = await prisma.tahsilatBildirimIsi.findMany({
    where: {
      durum: BildirimIsDurumu.GONDERILDI,
      providerBulkId: { not: null },
      OR: [{ raporSonrakiSorguAt: null }, { raporSonrakiSorguAt: { lte: now } }],
      raporSorguDeneme: { lt: 20 }
    },
    orderBy: { sonDenemeAt: 'asc' },
    take: limit
  })

  const provider = getSmsProvider(false)
  let delivered = 0
  let failed = 0
  let waiting = 0

  for (const job of jobs) {
    const report = await provider.queryReport(job.providerBulkId!)
    if (report.status === 'TESLIM_EDILDI') {
      delivered += 1
      await prisma.tahsilatBildirimIsi.update({
        where: { id: job.id },
        data: { durum: BildirimIsDurumu.TESLIM_EDILDI, raporSorguDeneme: { increment: 1 }, raporSonrakiSorguAt: null }
      })
      continue
    }
    if (report.status === 'BASARISIZ') {
      failed += 1
      const amount = job.smsKrediTuketimi ?? 0
      if (amount > 0) {
        await refundSmsCredit({
          tenantId: job.tenantId,
          bildirimIsiId: job.id,
          amount,
          idempotencyKey: `refund:${job.id}:${report.code ?? 'FAILED'}`
        })
      }
      await prisma.tahsilatBildirimIsi.update({
        where: { id: job.id },
        data: {
          durum: BildirimIsDurumu.BASARISIZ,
          hataOzeti: report.message ?? 'SMS teslim raporu başarısız.',
          sonProviderHataKodu: report.code ?? null,
          raporSorguDeneme: { increment: 1 },
          raporSonrakiSorguAt: null
        }
      })
      continue
    }
    waiting += 1
    const nextDelayMin = Math.min(240, Math.max(2, Math.pow(2, Math.min(job.raporSorguDeneme, 6))))
    await prisma.tahsilatBildirimIsi.update({
      where: { id: job.id },
      data: {
        raporSorguDeneme: { increment: 1 },
        raporSonrakiSorguAt: new Date(now.getTime() + nextDelayMin * 60_000)
      }
    })
  }

  return { checked: jobs.length, delivered, failed, waiting }
}
