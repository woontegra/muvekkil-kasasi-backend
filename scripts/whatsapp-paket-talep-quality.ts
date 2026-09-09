/**
 * WhatsApp mesaj paketi satın alma talebi kalite testleri.
 *
 *   npm run test:whatsapp-paket-talep
 */
import 'dotenv/config'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { WhatsAppMesajKrediHareketTipi, WhatsAppMesajPaketTalepDurum } from '@prisma/client'
import { createApp } from '../src/app.js'
import { signAccessToken } from '../src/auth/jwt.js'
import { signAdminAccessToken } from '../src/auth/adminJwt.js'
import { AppError } from '../src/middleware/errorHandler.js'
import { prisma } from '../src/lib/prisma.js'
import {
  adjustManuelCredit,
  ensureWhatsAppMesajKredisi,
  getBalance
} from '../src/tahsilatBildirim/whatsappMesajKredi.service.js'
import { getWhatsAppMesajPaketiById } from '../src/tahsilatBildirim/whatsappMesajPaketleri.js'
import {
  adminOnaylaWhatsAppMesajPaketTalebi,
  adminReddetWhatsAppMesajPaketTalebi,
  createWhatsAppMesajPaketTalebi
} from '../src/tahsilatBildirim/whatsappMesajPaketTalep.service.js'

const TAG = `quality-wa-paket-talep-${Date.now()}`

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`FAIL: ${m}`)
}

let n = 0
function ok(name: string): void {
  n += 1
  // eslint-disable-next-line no-console
  console.log(`OK  ${name}`)
}

async function main(): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { aktifMi: true, role: { in: ['BURO_SAHIBI', 'AVUKAT_YONETICI'] } },
    select: { id: true, role: true, kullaniciAdi: true, tenantId: true }
  })
  assert(Boolean(user), 'yonetici kullanıcı yok')
  const tenantId = user!.tenantId

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, buroAdi: true }
  })
  assert(Boolean(tenant), 'tenant yok')

  const otherTenant = await prisma.tenant.findFirst({
    where: { aktifMi: true, id: { not: tenantId } },
    select: { id: true }
  })

  const admin = await prisma.superAdmin.findFirst({
    where: { aktifMi: true, rol: { in: ['SUPER_ADMIN', 'DESTEK', 'FINANS'] } },
    select: { id: true, rol: true, kullaniciAdi: true }
  })
  assert(Boolean(admin), 'platform admin yok')

  await ensureWhatsAppMesajKredisi(tenantId)
  const snapshot = await getBalance(tenantId)
  // eslint-disable-next-line no-console
  console.log(`tenant=${tenant!.buroAdi} snapshot=${snapshot}`)

  const createdIds: string[] = []
  let otherSnapshot: number | null = null

  try {
    // Temiz başlangıç: bekleyen talepleri iptal et (test izolasyonu)
    await prisma.whatsAppMesajPaketTalebi.updateMany({
      where: { tenantId, durum: WhatsAppMesajPaketTalepDurum.BEKLIYOR },
      data: {
        durum: WhatsAppMesajPaketTalepDurum.IPTAL,
        adminNotu: `${TAG} pre-clean`
      }
    })

    const cur = await getBalance(tenantId)
    if (cur !== snapshot) {
      // leave as is
    }

    const paket500 = getWhatsAppMesajPaketiById('wa_msg_500')!
    assert(paket500.fiyatTL === 250 && paket500.mesajAdedi === 500, 'katalog 500')

    const t500Res = await createWhatsAppMesajPaketTalebi({
      tenantId,
      userId: user!.id,
      packageId: 'wa_msg_500'
    })
    const t500 = t500Res.talep
    createdIds.push(t500.id)
    assert(t500Res.alreadyExists === false, 'yeni talep')
    assert(t500.durum === 'BEKLIYOR', 'durum BEKLIYOR')
    assert(t500.mesajAdedi === 500 && t500.fiyatTL === 250, 'katalog snapshot')
    assert(/^WA-\d{8}-\d{4}$/.test(t500.paymentReference), `paymentRef=${t500.paymentReference}`)
    assert(t500.tenantId === tenantId, 'tenant id')
    ok('500 talep oluşturma')

    // Fiyat manipülasyonu etkisiz: client fiyat gönderemez; yanlış id fail
    let badId = false
    try {
      await createWhatsAppMesajPaketTalebi({
        tenantId,
        userId: user!.id,
        packageId: 'hack_price_999'
      })
    } catch (e) {
      badId = e instanceof AppError && e.code === 'WA_PAKET_NOT_FOUND'
    }
    assert(badId, 'geçersiz paket id reddedilir')
    ok('fiyat/paket manipülasyonu etkisiz')

    let dup = false
    const again = await createWhatsAppMesajPaketTalebi({
      tenantId,
      userId: user!.id,
      packageId: 'wa_msg_500'
    })
    assert(again.alreadyExists === true, 'alreadyExists')
    assert(again.talep.id === t500.id, 'aynı talep id')
    assert(again.talep.paymentReference === t500.paymentReference, 'duplicate aynı paymentReference')
    assert(again.talep.durum === 'BEKLIYOR', 'hâlâ BEKLIYOR')
    dup = true
    assert(dup, 'duplicate bekleyen engellenmeli')
    ok('aynı paket için bekleyen duplicate kontrolü')

    if (otherTenant) {
      await ensureWhatsAppMesajKredisi(otherTenant.id)
      otherSnapshot = await getBalance(otherTenant.id)
      const tOtherRes = await createWhatsAppMesajPaketTalebi({
        tenantId: otherTenant.id,
        userId: user!.id,
        packageId: 'wa_msg_500'
      })
      const tOther = tOtherRes.talep
      createdIds.push(tOther.id)
      assert(tOther.tenantId === otherTenant.id, 'diğer tenant kendi talebi')
      const balA = await getBalance(tenantId)
      await adminOnaylaWhatsAppMesajPaketTalebi({
        talepId: tOther.id,
        adminId: admin!.id,
        adminNotu: `${TAG} other-approve`
      })
      assert((await getBalance(tenantId)) === balA, 'tenant A bakiyesi değişmedi')
      assert((await getBalance(otherTenant.id)) === otherSnapshot + 500, 'kredi yalnız B tenant')
      ok('tenant izolasyonu (onay hedef tenant)')
    } else {
      ok('tenant izolasyonu (ikinci tenant yok — atlandı)')
    }

    const before = await getBalance(tenantId)
    const onay = await adminOnaylaWhatsAppMesajPaketTalebi({
      talepId: t500.id,
      adminId: admin!.id,
      adminNotu: `${TAG} onay-500`
    })
    assert(onay.talep.durum === 'ONAYLANDI', 'onaylandı')
    assert(!onay.credit.alreadyApplied, 'ilk onay kredi')
    assert(onay.credit.sonrakiBakiye === before + 500, '+500')
    assert((await getBalance(tenantId)) === before + 500, 'bakiye +500')
    ok('admin onay → +500')

    const onayAgain = await adminOnaylaWhatsAppMesajPaketTalebi({
      talepId: t500.id,
      adminId: admin!.id,
      adminNotu: `${TAG} ikinci-onay`
    })
    assert(onayAgain.credit.alreadyApplied, 'ikinci onay alreadyApplied')
    assert((await getBalance(tenantId)) === before + 500, 'ikinci onay +0')
    const hareket = await prisma.whatsAppMesajKrediHareketi.count({
      where: {
        tenantId,
        tip: WhatsAppMesajKrediHareketTipi.PAKET_SATIN_ALMA,
        paymentId: t500.id
      }
    })
    assert(hareket === 1, 'tek paket hareketi')
    ok('ikinci onay → +0')

    // Red → kredi yok
    await prisma.whatsAppMesajPaketTalebi.updateMany({
      where: { tenantId, packageId: 'wa_msg_1000', durum: WhatsAppMesajPaketTalepDurum.BEKLIYOR },
      data: { durum: WhatsAppMesajPaketTalepDurum.IPTAL, adminNotu: `${TAG} clean-1000` }
    })
    const t1000Res = await createWhatsAppMesajPaketTalebi({
      tenantId,
      userId: user!.id,
      packageId: 'wa_msg_1000'
    })
    const t1000 = t1000Res.talep
    createdIds.push(t1000.id)
    const beforeRed = await getBalance(tenantId)
    await adminReddetWhatsAppMesajPaketTalebi({
      talepId: t1000.id,
      adminId: admin!.id,
      adminNotu: `${TAG} red`
    })
    assert((await getBalance(tenantId)) === beforeRed, 'red sonrası bakiye aynı')
    ok('admin red → kredi yok')

    // Onaylanmış talep reddedilemez
    let cannotReject = false
    try {
      await adminReddetWhatsAppMesajPaketTalebi({
        talepId: t500.id,
        adminId: admin!.id,
        adminNotu: `${TAG} reject-approved`
      })
    } catch (e) {
      cannotReject = e instanceof AppError && e.code === 'WA_PAKET_TALEP_ALREADY_APPROVED'
    }
    assert(cannotReject, 'onaylanmış talep reddedilemez')
    ok('onaylanmış talep reddedilemez')

    // 1000 paket onay → mevcut bakiyeye +1000
    await prisma.whatsAppMesajPaketTalebi.updateMany({
      where: { tenantId, packageId: 'wa_msg_1000', durum: WhatsAppMesajPaketTalepDurum.BEKLIYOR },
      data: { durum: WhatsAppMesajPaketTalepDurum.IPTAL, adminNotu: `${TAG} clean-1000-b` }
    })
    const t1000OkRes = await createWhatsAppMesajPaketTalebi({
      tenantId,
      userId: user!.id,
      packageId: 'wa_msg_1000'
    })
    const t1000Ok = t1000OkRes.talep
    createdIds.push(t1000Ok.id)
    assert(t1000Ok.mesajAdedi === 1000 && t1000Ok.fiyatTL === 400, '1000 katalog')
    const before1000 = await getBalance(tenantId)
    const onay1000 = await adminOnaylaWhatsAppMesajPaketTalebi({
      talepId: t1000Ok.id,
      adminId: admin!.id,
      adminNotu: `${TAG} onay-1000`
    })
    assert(!onay1000.credit.alreadyApplied, '1000 ilk onay')
    assert(onay1000.credit.sonrakiBakiye === before1000 + 1000, '+1000')
    assert((await getBalance(tenantId)) === before1000 + 1000, 'bakiye +1000')
    const tipCount = await prisma.whatsAppMesajKrediHareketi.count({
      where: {
        tenantId,
        tip: WhatsAppMesajKrediHareketTipi.PAKET_SATIN_ALMA,
        paymentId: t1000Ok.id
      }
    })
    assert(tipCount === 1, 'PAKET_SATIN_ALMA hareket')
    ok('admin 1000 onay → +1000 (PAKET_SATIN_ALMA)')

    // HTTP: tenant JWT admin endpointine erişemez; satin-al-link yok
    const app = createApp()
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const base = `http://127.0.0.1:${port}`

    try {
      const tenantToken = signAccessToken({
        userId: user!.id,
        tenantId,
        role: user!.role,
        kullaniciAdi: user!.kullaniciAdi
      })
      const deny = await fetch(`${base}/api/v1/admin/whatsapp-mesaj-paket-talepleri`, {
        headers: { Authorization: `Bearer ${tenantToken}` }
      })
      assert(deny.status === 401 || deny.status === 403, `tenant admin list engelli (${deny.status})`)
      ok('normal tenant admin endpointine erişemez')

      const gone = await fetch(`${base}/api/v1/whatsapp-mesaj-kredisi/satin-al-link`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ packageId: 'wa_msg_500' })
      })
      assert(gone.status === 404, `satin-al-link kaldırıldı (${gone.status})`)
      ok('Website satin-al-link kaldırıldı')

      const rejectExtra = await fetch(`${base}/api/v1/whatsapp-mesaj-kredisi/talepler`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ packageId: 'wa_msg_2500', fiyatTL: 1, mesajAdedi: 99999 })
      })
      assert(rejectExtra.status === 400, `extra alanlar reddedilir (${rejectExtra.status})`)

      // Önceki 2500 bekleyen varsa temizle
      await prisma.whatsAppMesajPaketTalebi.updateMany({
        where: {
          tenantId,
          packageId: 'wa_msg_2500',
          durum: WhatsAppMesajPaketTalepDurum.BEKLIYOR
        },
        data: { durum: WhatsAppMesajPaketTalepDurum.IPTAL, adminNotu: `${TAG} clean-2500` }
      })

      const createHttp = await fetch(`${base}/api/v1/whatsapp-mesaj-kredisi/talepler`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ packageId: 'wa_msg_2500' })
      })
      assert(createHttp.status === 201, `HTTP talep create (${createHttp.status})`)
      const body = (await createHttp.json()) as {
        talep?: { fiyatTL?: number; mesajAdedi?: number; id?: string }
      }
      createdIds.push(body.talep!.id!)
      assert(body.talep!.fiyatTL === 750 && body.talep!.mesajAdedi === 2500, 'HTTP katalog fiyat')
      ok('HTTP talep — client fiyat yok sayılır / reddedilir')

      // Tenant A, tenant B talebini listede göremez
      if (otherTenant) {
        const listMine = await fetch(`${base}/api/v1/whatsapp-mesaj-kredisi/talepler`, {
          headers: { Authorization: `Bearer ${tenantToken}` }
        })
        assert(listMine.status === 200, `list mine (${listMine.status})`)
        const listBody = (await listMine.json()) as { items?: Array<{ tenantId?: string }> }
        assert(
          (listBody.items ?? []).every((i) => i.tenantId === tenantId),
          'liste yalnız kendi tenant'
        )
        ok('tenant A tenant B talebini göremez')
      } else {
        ok('tenant A tenant B talebini göremez (ikinci tenant yok — atlandı)')
      }

      const adminToken = signAdminAccessToken({
        adminId: admin!.id,
        role: admin!.rol,
        kullaniciAdi: admin!.kullaniciAdi
      })
      const listOk = await fetch(`${base}/api/v1/admin/whatsapp-mesaj-paket-talepleri?durum=BEKLIYOR`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      })
      assert(listOk.status === 200, `admin list (${listOk.status})`)
      const filterAll = await fetch(`${base}/api/v1/admin/whatsapp-mesaj-paket-talepleri`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      })
      assert(filterAll.status === 200, `admin filter all (${filterAll.status})`)
      const filterOnay = await fetch(
        `${base}/api/v1/admin/whatsapp-mesaj-paket-talepleri?durum=ONAYLANDI`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      )
      assert(filterOnay.status === 200, `admin filter onay (${filterOnay.status})`)
      const filterRed = await fetch(
        `${base}/api/v1/admin/whatsapp-mesaj-paket-talepleri?durum=REDDEDILDI`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      )
      assert(filterRed.status === 200, `admin filter red (${filterRed.status})`)
      ok('admin liste filtreleri')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()))
      })
    }

    // eslint-disable-next-line no-console
    console.log(`${n} paket talep senaryosu geçti.`)
  } finally {
    for (const id of createdIds) {
      await prisma.whatsAppMesajKrediHareketi.deleteMany({
        where: { paymentId: id }
      })
    }
    await prisma.whatsAppMesajPaketTalebi.deleteMany({
      where: { id: { in: createdIds } }
    })
    await prisma.whatsAppMesajPaketTalebi.deleteMany({
      where: { adminNotu: { contains: TAG } }
    })

    async function restore(tid: string, target: number): Promise<void> {
      const endBal = await getBalance(tid)
      if (endBal === target) return
      if (endBal > target) {
        await adjustManuelCredit({
          tenantId: tid,
          amount: endBal - target,
          yon: 'DUS',
          aciklama: `${TAG} restore-down`
        })
      } else {
        await adjustManuelCredit({
          tenantId: tid,
          amount: target - endBal,
          yon: 'EKLE',
          aciklama: `${TAG} restore-up`
        })
      }
      await prisma.whatsAppMesajKrediHareketi.deleteMany({
        where: { tenantId: tid, aciklama: { contains: TAG } }
      })
    }

    await restore(tenantId, snapshot)
    if (otherTenant && otherSnapshot != null) {
      await restore(otherTenant.id, otherSnapshot)
    }

    // eslint-disable-next-line no-console
    console.log(`restore bakiye: ${await getBalance(tenantId)} (hedef ${snapshot})`)
    await prisma.$disconnect()
  }
}

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
