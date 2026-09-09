/**
 * UX: boş açıklama ile +500 (Woontegra tenant).
 *   npx tsx scripts/whatsapp-admin-kredi-empty-note-ux.ts
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import {
  adjustManuelCredit,
  ensureWhatsAppMesajKredisi,
  getBalance,
  getTransactions
} from '../src/tahsilatBildirim/whatsappMesajKredi.service.js'
import { adminAdjustTenantWhatsAppKredi } from '../src/admin/adminWhatsAppKredi.service.js'

const TAG = `ux-empty-note-${Date.now()}`

async function main(): Promise<void> {
  const t = await prisma.tenant.findFirst({
    where: {
      OR: [
        { buroAdi: { contains: 'Woontegra', mode: 'insensitive' } },
        { slug: { contains: 'woontegra', mode: 'insensitive' } }
      ]
    },
    select: { id: true, buroAdi: true }
  })
  if (!t) throw new Error('Woontegra tenant bulunamadı')

  const admin = await prisma.superAdmin.findFirst({
    where: { aktifMi: true },
    select: { id: true }
  })
  if (!admin) throw new Error('admin yok')

  await ensureWhatsAppMesajKredisi(t.id)
  const snap = await getBalance(t.id)
  // eslint-disable-next-line no-console
  console.log(`tenant=${t.buroAdi} snapshot=${snap}`)

  if (snap > 0) {
    await adjustManuelCredit({
      tenantId: t.id,
      amount: snap,
      yon: 'DUS',
      aciklama: `${TAG} drain`
    })
  }
  const start = await getBalance(t.id)
  if (start !== 0) throw new Error(`başlangıç 0 olmalı, gelen ${start}`)
  // eslint-disable-next-line no-console
  console.log('start=0')

  const fakeReq = {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' }
  } as unknown as import('express').Request

  const out = await adminAdjustTenantWhatsAppKredi({
    tenantId: t.id,
    adminId: admin.id,
    req: fakeReq,
    yon: 'EKLE',
    miktar: 500,
    aciklama: ''
  })

  const bal = await getBalance(t.id)
  const last = (await getTransactions(t.id, { limit: 1 })).items[0]
  // eslint-disable-next-line no-console
  console.log(
    `result onceki=${out.oncekiBakiye} sonraki=${out.sonrakiBakiye} bakiye=${bal} hareket=${last?.miktar} aciklama=${last?.aciklama}`
  )

  if (bal !== 500) throw new Error(`beklenen bakiye 500, gelen ${bal}`)
  if (last?.miktar !== 500) throw new Error('hareket +500 yok')
  if (last.aciklama !== 'Platform Admin manuel kredi işlemi') {
    throw new Error(`varsayılan açıklama bekleniyordu: ${last.aciklama}`)
  }
  // eslint-disable-next-line no-console
  console.log('PASS 0→500 empty aciklama')

  // restore
  await adjustManuelCredit({
    tenantId: t.id,
    amount: 500,
    yon: 'DUS',
    aciklama: `${TAG} restore`
  })
  await prisma.whatsAppMesajKrediHareketi.deleteMany({
    where: {
      tenantId: t.id,
      OR: [
        { aciklama: { contains: TAG } },
        {
          tip: 'MANUEL_DUZELTME',
          miktar: 500,
          aciklama: 'Platform Admin manuel kredi işlemi',
          createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) }
        }
      ]
    }
  })
  const end = await getBalance(t.id)
  if (end !== snap) {
    if (end < snap) {
      await adjustManuelCredit({
        tenantId: t.id,
        amount: snap - end,
        yon: 'EKLE',
        aciklama: `${TAG} up`
      })
    } else {
      await adjustManuelCredit({
        tenantId: t.id,
        amount: end - snap,
        yon: 'DUS',
        aciklama: `${TAG} down`
      })
    }
    await prisma.whatsAppMesajKrediHareketi.deleteMany({
      where: { tenantId: t.id, aciklama: { contains: TAG } }
    })
  }
  // eslint-disable-next-line no-console
  console.log(`restored=${await getBalance(t.id)} hedef=${snap}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
