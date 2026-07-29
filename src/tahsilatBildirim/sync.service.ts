import { BildirimIsDurumu, Prisma, VekaletTaksitOdemeDurumu } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { planJobsForTenant } from './planner.service.js'

function sumOdeme(tutarlar: { tutar: { toString: () => string } }[]): number {
  return tutarlar.reduce((s, o) => s + Number(o.tutar), 0)
}

/**
 * Ödeme değişince bekleyen işleri güncelle/iptal et; ardından tenant için yeniden planla.
 * Ödeme akışını bloklamamak için çağıran taraf fire-and-forget kullanmalı.
 */
export async function onTaksitOdemeChanged(tenantId: string, taksitId: string): Promise<void> {
  const taksit = await prisma.vekaletTaksiti.findFirst({
    where: { id: taksitId, tenantId },
    include: { odemeler: { select: { tutar: true } } }
  })
  if (!taksit) return

  const kalan = Math.max(0, Number(taksit.tutar) - sumOdeme(taksit.odemeler))
  const iptal = taksit.odemeDurumu === VekaletTaksitOdemeDurumu.IPTAL

  if (iptal || kalan <= 0.001) {
    await prisma.tahsilatBildirimIsi.updateMany({
      where: {
        tenantId,
        taksitId,
        durum: { in: [BildirimIsDurumu.PLANLANDI, BildirimIsDurumu.KUYRUKTA] }
      },
      data: {
        durum: BildirimIsDurumu.IPTAL_EDILDI,
        iptalNedeni: iptal ? 'Taksit iptal edildi' : 'Borç kapandı',
        lockedAt: null,
        lockedBy: null
      }
    })
  } else {
    await prisma.tahsilatBildirimIsi.updateMany({
      where: {
        tenantId,
        taksitId,
        durum: { in: [BildirimIsDurumu.PLANLANDI, BildirimIsDurumu.KUYRUKTA] }
      },
      data: {
        kalanTutarSnapshot: new Prisma.Decimal(kalan.toFixed(2))
      }
    })
  }

  await planJobsForTenant(tenantId)
}
