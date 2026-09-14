/**
 * Gerçek TCMB doğrulama — fixture yok.
 * JWT’yi DB’den salt SELECT ile kullanıcı okuyup imzalar (login UPDATE yok).
 * Production’a migration/write yapmaz.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import {
  buildTcmbHistoricalUrl,
  buildTcmbTodayUrl,
  clearTcmbCacheForTests,
  parseTcmbXml
} from '../src/lib/tcmbKur.service.js'
import { TENANT_JWT_AUD, TENANT_JWT_ISS } from '../src/auth/jwt.js'

function loadEnv(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i < 0) continue
      const k = t.slice(0, i).trim()
      let v = t.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (!(k in process.env)) process.env[k] = v
    }
  } catch {
    /* ignore */
  }
}

loadEnv()

const API = process.env.VERIFY_API_BASE ?? 'http://127.0.0.1:4100'
const secret = process.env.JWT_SECRET
if (!secret) {
  console.error('JWT_SECRET yok')
  process.exit(1)
}

const prisma = new PrismaClient()

async function main(): Promise<void> {
  clearTcmbCacheForTests()

  const user = await prisma.user.findFirst({
    where: { aktifMi: true, tenant: { aktifMi: true } },
    select: { id: true, tenantId: true, kullaniciAdi: true, role: true }
  })
  if (!user) {
    console.error('Aktif kullanıcı bulunamadı (yalnız SELECT).')
    process.exit(1)
  }

  const accessToken = jwt.sign(
    {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      kullaniciAdi: user.kullaniciAdi,
      typ: 'tenant'
    },
    secret!,
    { algorithm: 'HS256', expiresIn: '10m', issuer: TENANT_JWT_ISS, audience: TENANT_JWT_AUD }
  )

  const res = await fetch(`${API}/api/v1/kurlar/tcmb`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  })
  const bodyText = await res.text()
  let api: Record<string, unknown>
  try {
    api = JSON.parse(bodyText) as Record<string, unknown>
  } catch {
    console.error('API JSON değil', res.status, bodyText.slice(0, 500))
    process.exit(1)
  }

  console.log('=== HTTP GET /api/v1/kurlar/tcmb ===')
  console.log(JSON.stringify(api, null, 2))

  if (!api.available) {
    console.error('API available=false')
    process.exit(1)
  }

  const istenilen = String(api.istenilenTarih)
  const bulunan = String(api.bulunanTcmbKurTarihi)
  const todayUrl = buildTcmbTodayUrl()
  const histUrl = buildTcmbHistoricalUrl(bulunan)

  // Servisin kullandığı kaynak: önce today dene, XML tarihini API bulunan ile eşleştir
  let usedUrl = todayUrl
  let xml = await (await fetch(todayUrl)).text()
  let parsed = parseTcmbXml(xml)
  if (parsed.tarih !== bulunan) {
    usedUrl = histUrl
    const r2 = await fetch(histUrl)
    if (!r2.ok) throw new Error(`XML HTTP ${r2.status} ${histUrl}`)
    xml = await r2.text()
    parsed = parseTcmbXml(xml)
  }

  const apiUsd = String(api.usdDovizAlis)
  const apiEur = String(api.eurDovizAlis)
  const xmlUsd = parsed.usdBuying.toFixed(8)
  const xmlEur = parsed.eurBuying.toFixed(8)

  console.log('\n=== Ham TCMB XML doğrulama ===')
  console.log('xmlUrl:', usedUrl)
  console.log('xml.Tarih (ISO):', parsed.tarih)
  console.log('xml USD ForexBuying:', xmlUsd)
  console.log('xml EUR ForexBuying:', xmlEur)
  console.log('api  USD Döviz Alış:', apiUsd)
  console.log('api  EUR Döviz Alış:', apiEur)
  console.log('bulunanTcmbKurTarihi:', bulunan)
  console.log('istenilenTarih:', istenilen)
  console.log('fallbackKullanildi:', api.fallbackKullanildi)
  console.log('stale:', api.stale)

  const usdOk = apiUsd === xmlUsd
  const eurOk = apiEur === xmlEur
  const dateOk = bulunan === parsed.tarih
  console.log('\n=== Karşılaştırma ===')
  console.log('USD eşleşmesi:', usdOk ? 'OK' : 'FAIL')
  console.log('EUR eşleşmesi:', eurOk ? 'OK' : 'FAIL')
  console.log('Tarih eşleşmesi:', dateOk ? 'OK' : 'FAIL')
  console.log(
    'NOT: Rapordaki 34.80000000 / 37.50000000 yalnız birim test fixture değerleridir; bu çalıştırmanın cevabı değildir.'
  )

  if (!usdOk || !eurOk || !dateOk) process.exit(2)
  console.log('\nVERIFY_OK')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
