import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { TENANT_JWT_AUD, TENANT_JWT_ISS } from '../src/auth/jwt.js'

const prisma = new PrismaClient()
const API = process.env.VERIFY_API_BASE ?? 'http://127.0.0.1:4100'
const secret = process.env.JWT_SECRET
if (!secret) {
  console.error('JWT_SECRET missing')
  process.exit(1)
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { aktifMi: true, tenant: { aktifMi: true } },
    select: { id: true, tenantId: true, kullaniciAdi: true, role: true }
  })
  if (!user) throw new Error('No active user')

  const token = jwt.sign(
    {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      kullaniciAdi: user.kullaniciAdi,
      typ: 'tenant'
    },
    secret!,
    { algorithm: 'HS256', expiresIn: '5m', issuer: TENANT_JWT_ISS, audience: TENANT_JWT_AUD }
  )

  const res = await fetch(`${API}/api/v1/ofis-kasasi/hareketler?page=1&limit=50`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  })
  const text = await res.text()
  let body: Record<string, unknown> | null = null
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = null
  }

  const msg = String(body?.message ?? text)
  const leak =
    /prisma|invocation|kur_kaynagi|column .* does not exist|[A-Za-z]:\\Users\\|at\s+\w+\s+\(/i.test(msg) ||
    /stack|PrismaClient/i.test(text)

  console.log(
    JSON.stringify(
      {
        status: res.status,
        ok: body?.ok ?? null,
        hasItems: Array.isArray((body as { items?: unknown })?.items)
          ? ((body as { items: unknown[] }).items.length >= 0)
          : Array.isArray((body as { hareketler?: unknown })?.hareketler) ||
            typeof (body as { total?: unknown })?.total === 'number' ||
            body?.ok === true,
        messageSafe: !leak,
        messagePreview: msg.slice(0, 120),
        leakDetected: leak
      },
      null,
      2
    )
  )

  if (res.status !== 200 || leak) process.exit(2)
}

main()
  .catch((e) => {
    console.error(String(e?.message ?? e).slice(0, 200))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
