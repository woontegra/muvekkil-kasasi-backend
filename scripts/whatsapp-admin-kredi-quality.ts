/**
 * Platform Admin WhatsApp mesaj kredisi manuel yönetim kalite testleri.
 *
 *   npm run test:whatsapp-admin-kredi
 */

import 'dotenv/config'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { WhatsAppMesajKrediHareketTipi } from '@prisma/client'
import { createApp } from '../src/app.js'
import { signAccessToken } from '../src/auth/jwt.js'
import { signAdminAccessToken } from '../src/auth/adminJwt.js'
import { AppError } from '../src/middleware/errorHandler.js'
import { prisma } from '../src/lib/prisma.js'
import {
  adjustManuelCredit,
  ensureWhatsAppMesajKredisi,
  getBalance,
  getTransactions
} from '../src/tahsilatBildirim/whatsappMesajKredi.service.js'
import {
  adminAdjustTenantWhatsAppKredi,
  adminGetTenantWhatsAppKredi
} from '../src/admin/adminWhatsAppKredi.service.js'
import { requireSafeTestDatabaseOrExit } from '../src/lib/assertSafeTestDatabase.js'

requireSafeTestDatabaseOrExit()

const TAG = `quality-wa-admin-kredi-${Date.now()}`

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

let n = 0
function ok(name: string): void {
  n += 1
  // eslint-disable-next-line no-console
  console.log(`OK  ${name}`)
}

async function restoreBalance(tenantId: string, target: number): Promise<void> {
  const cur = await getBalance(tenantId)
  if (cur === target) return
  if (cur < target) {
    await adjustManuelCredit({
      tenantId,
      amount: target - cur,
      yon: 'EKLE',
      aciklama: `${TAG} restore-up`
    })
  } else {
    await adjustManuelCredit({
      tenantId,
      amount: cur - target,
      yon: 'DUS',
      aciklama: `${TAG} restore-down`
    })
  }
}

async function main(): Promise<void> {
  const tenantUser = await prisma.user.findFirst({
    where: {
      aktifMi: true,
      tenant: { aktifMi: true }
    },
    select: {
      id: true,
      role: true,
      kullaniciAdi: true,
      tenantId: true,
      tenant: { select: { id: true, buroAdi: true } }
    }
  })
  assert(Boolean(tenantUser?.tenant), 'aktif tenant + kullanıcı yok')
  const tenantId = tenantUser!.tenantId
  // eslint-disable-next-line no-console
  console.log(`tenant: ${tenantUser!.tenant.buroAdi} (${tenantId})`)

  await ensureWhatsAppMesajKredisi(tenantId)
  const snapshot = await getBalance(tenantId)
  // eslint-disable-next-line no-console
  console.log(`snapshot bakiye: ${snapshot}`)

  try {
    await restoreBalance(tenantId, 0)
    assert((await getBalance(tenantId)) === 0, 'başlangıç 0')

    const a500 = await adjustManuelCredit({
      tenantId,
      amount: 500,
      yon: 'EKLE',
      aciklama: `${TAG} +500`
    })
    assert(a500.sonrakiBakiye === 500, '+500 bakiye')
    assert((await getBalance(tenantId)) === 500, '+500 getBalance')
    ok('admin +500 → doğru bakiye')

    const a1000 = await adjustManuelCredit({
      tenantId,
      amount: 1000,
      yon: 'EKLE',
      aciklama: `${TAG} +1000`
    })
    assert(a1000.oncekiBakiye === 500 && a1000.sonrakiBakiye === 1500, '+1000 stack')
    assert((await getBalance(tenantId)) === 1500, '+1000 getBalance')
    ok('admin +1000 → mevcut bakiyeye eklenir')

    const d100 = await adjustManuelCredit({
      tenantId,
      amount: 100,
      yon: 'DUS',
      aciklama: `${TAG} -100`
    })
    assert(d100.oncekiBakiye === 1500 && d100.sonrakiBakiye === 1400, '-100 bakiye')
    assert((await getBalance(tenantId)) === 1400, '-100 getBalance')
    ok('admin -100 → doğru bakiye')

    let overRejected = false
    try {
      await adjustManuelCredit({
        tenantId,
        amount: 99999,
        yon: 'DUS',
        aciklama: `${TAG} over-deduct`
      })
    } catch (e) {
      overRejected =
        e instanceof AppError && (e.statusCode === 422 || e.code === 'WA_KREDI_INSUFFICIENT')
    }
    assert(overRejected, 'bakiyeden fazla düşme reddedilmeli')
    assert((await getBalance(tenantId)) === 1400, 'over-deduct bakiye değişmedi')
    ok('bakiyeden fazla düşme → reddedilir')

    let zeroRejected = false
    try {
      await adjustManuelCredit({
        tenantId,
        amount: 0,
        yon: 'EKLE',
        aciklama: `${TAG} zero`
      })
    } catch (e) {
      zeroRejected = e instanceof AppError && e.code === 'WA_KREDI_INVALID_AMOUNT'
    }
    assert(zeroRejected, '0 miktar reddedilmeli')
    ok('0 / hatalı miktar → reddedilir')

    const tx = await getTransactions(tenantId, { limit: 20 })
    const tagged = tx.items.filter((h) => (h.aciklama ?? '').includes(TAG))
    assert(tagged.length >= 3, 'hareket kaydı oluştu')
    const lastAdd = tagged.find((h) => h.miktar === 1000 && h.tip === WhatsAppMesajKrediHareketTipi.MANUEL_DUZELTME)
    const lastDus = tagged.find((h) => h.miktar === -100 && h.tip === WhatsAppMesajKrediHareketTipi.MANUEL_DUZELTME)
    assert(Boolean(lastAdd), '+1000 hareket MANUEL_DUZELTME')
    assert(Boolean(lastDus), '-100 hareket negatif MANUEL_DUZELTME')
    ok('hareket kaydı doğru')

    const admin = await prisma.superAdmin.findFirst({
      where: { aktifMi: true, rol: { in: ['SUPER_ADMIN', 'DESTEK', 'FINANS'] } },
      select: { id: true, rol: true, kullaniciAdi: true }
    })
    assert(Boolean(admin), 'aktif platform admin yok')

    const ozet = await adminGetTenantWhatsAppKredi(tenantId)
    assert(ozet.bakiye === 1400, 'admin ozet bakiye')
    assert(ozet.toplamEklenen >= 1500, 'admin ozet toplamEklenen')

    const fakeReq = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      ip: '127.0.0.1'
    } as unknown as import('express').Request
    const adj = await adminAdjustTenantWhatsAppKredi({
      tenantId,
      adminId: admin!.id,
      req: fakeReq,
      yon: 'EKLE',
      miktar: 50,
      aciklama: `${TAG} admin-svc +50`
    })
    assert(adj.sonrakiBakiye === 1450, 'admin service +50')
    ok('admin service adjust + audit yolu')

    const user = tenantUser!
    assert(Boolean(user), 'tenant kullanıcı yok')

    const app = createApp()
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const base = `http://127.0.0.1:${port}`

    try {
      const tenantToken = signAccessToken({
        userId: user.id,
        tenantId,
        role: user.role,
        kullaniciAdi: user.kullaniciAdi
      })
      const deny = await fetch(`${base}/api/v1/admin/tenants/${tenantId}/whatsapp-kredi`, {
        headers: { Authorization: `Bearer ${tenantToken}` }
      })
      assert(deny.status === 401 || deny.status === 403, `tenant JWT engelli (got ${deny.status})`)
      ok('normal tenant → admin endpoint 401/403')

      const denyAdj = await fetch(`${base}/api/v1/admin/tenants/${tenantId}/whatsapp-kredi/adjust`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ yon: 'EKLE', miktar: 1, aciklama: 'hack' })
      })
      assert(
        denyAdj.status === 401 || denyAdj.status === 403,
        `tenant adjust engelli (got ${denyAdj.status})`
      )
      ok('normal tenant adjust → engelli')

      const adminToken = signAdminAccessToken({
        adminId: admin!.id,
        role: admin!.rol,
        kullaniciAdi: admin!.kullaniciAdi
      })
      const allow = await fetch(`${base}/api/v1/admin/tenants/${tenantId}/whatsapp-kredi`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      })
      assert(allow.status === 200, `admin GET ozet (got ${allow.status})`)
      const allowBody = (await allow.json()) as { bakiye?: number }
      assert(allowBody.bakiye === (await getBalance(tenantId)), 'HTTP ozet bakiye')
      ok('admin JWT → kredi özeti OK')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    }

    // eslint-disable-next-line no-console
    console.log(`${n} admin WhatsApp kredi senaryosu geçti.`)
  } finally {
    try {
      await restoreBalance(tenantId, snapshot)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('restore failed', e)
    }
    await prisma.whatsAppMesajKrediHareketi.deleteMany({
      where: { tenantId, aciklama: { contains: TAG } }
    })
    const end = await getBalance(tenantId)
    // eslint-disable-next-line no-console
    console.log(`restore bakiye: ${end} (hedef ${snapshot})`)
    await prisma.$disconnect()
  }
}

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
