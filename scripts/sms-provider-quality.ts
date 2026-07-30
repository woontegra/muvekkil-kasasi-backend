import { PrismaClient } from '@prisma/client'
import { calculateSmsParts } from '../src/tahsilatBildirim/smsParts.js'
import { MockSmsProvider } from '../src/tahsilatBildirim/providers/smsProvider.js'
import { ensureSmsWallet, reserveSmsCredit, releaseReservedSmsCredit } from '../src/tahsilatBildirim/smsWallet.service.js'

const prisma = new PrismaClient()

async function main() {
  const provider = new MockSmsProvider()
  const sent = await provider.send({
    tenantId: 'tenant-test',
    to: '905555555555',
    text: 'Test mesajı',
    idempotencyKey: 'k1'
  })
  if (!sent.ok) throw new Error('Mock send başarısız')

  const one = calculateSmsParts('Merhaba', 'TR')
  if (one.parts !== 1) throw new Error('Tek parça hesaplama bekleniyordu')

  const long = calculateSmsParts('ç'.repeat(120), 'TR')
  if (long.parts < 2) throw new Error('Çok parçalı hesaplama bekleniyordu')

  const table = await prisma.$queryRawUnsafe<Array<{ t: string | null }>>(
    `SELECT to_regclass('public.sms_tenant_bakiye')::text AS t`
  )
  if (!table[0]?.t) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'sms_tenant_bakiye migration uygulanmamis' }))
    return
  }

  const owner = await prisma.user.findFirst({
    where: { kullaniciAdi: 'e2e.sahip' },
    select: { tenantId: true }
  })
  if (!owner) throw new Error('e2e.sahip bulunamadı')
  await ensureSmsWallet(owner.tenantId)
  await prisma.smsTenantBakiye.update({
    where: { tenantId: owner.tenantId },
    data: { mevcutBakiye: 5 }
  })

  const r1 = await reserveSmsCredit({
    tenantId: owner.tenantId,
    amount: 3,
    idempotencyKey: 'test:sms:reserve:1'
  })
  if (!r1.ok) throw new Error('Rezerv başarısız')
  const r2 = await reserveSmsCredit({
    tenantId: owner.tenantId,
    amount: 3,
    idempotencyKey: 'test:sms:reserve:1'
  })
  if (!r2.ok) throw new Error('Idempotent rezerv başarısız')
  const insufficient = await reserveSmsCredit({
    tenantId: owner.tenantId,
    amount: 99,
    idempotencyKey: 'test:sms:reserve:2'
  })
  if (insufficient.ok) throw new Error('Yetersiz bakiye engellenmeliydi')

  await releaseReservedSmsCredit({
    tenantId: owner.tenantId,
    amount: 3,
    idempotencyKey: 'test:sms:release:1'
  })

  console.log(
    JSON.stringify({
      ok: true,
      mockSend: sent.code,
      onePart: one.parts,
      multiPart: long.parts,
      reserveIdempotent: true,
      insufficientBalanceBlocked: true
    })
  )
}

main().catch((err) => {
  console.error('[test:sms] failed', err instanceof Error ? err.message : err)
  process.exit(1)
}).finally(async () => prisma.$disconnect())
