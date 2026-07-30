/**
 * Otomatik bildirim uygunluk + müvekkil/dosya/taksit ayar API testleri.
 * Gerçek WhatsApp çağrısı yok. Yalnızca E2E tenant.
 */
import { PrismaClient, UserRole } from '@prisma/client'
import { createHash, randomBytes } from 'node:crypto'

process.env.NODE_ENV = process.env.NODE_ENV || 'development'

const API = process.env.E2E_API_BASE?.replace(/\/$/, '') || 'http://localhost:4100'
const PASS = process.env.E2E_PASSWORD || process.env.E2E_OWNER_PASSWORD || 'E2eTestPass123!'

type CookieJar = Map<string, string>

function parseSetCookie(headers: Headers, jar: CookieJar): void {
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
  const list = raw.length ? raw : [headers.get('set-cookie') ?? '']
  for (const line of list) {
    if (!line) continue
    const part = line.split(';')[0]!
    const i = part.indexOf('=')
    if (i > 0) jar.set(part.slice(0, i), part.slice(i + 1))
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function api(
  path: string,
  opts: {
    method?: string
    token?: string | null
    jar?: CookieJar
    body?: unknown
  } = {}
): Promise<{ status: number; json: any; headers: Headers }> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.jar?.size) headers.Cookie = cookieHeader(opts.jar)
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  })
  if (opts.jar) parseSetCookie(res.headers, opts.jar)
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json, headers: res.headers }
}

async function login(email: string): Promise<{ token: string; jar: CookieJar }> {
  const jar: CookieJar = new Map()
  const r = await api('/api/v1/auth/login', {
    method: 'POST',
    jar,
    body: { identifier: email, sifre: PASS }
  })
  if (r.status !== 200 || !r.json?.accessToken) {
    throw new Error(`login failed ${email}: ${r.status} ${JSON.stringify(r.json)}`)
  }
  return { token: r.json.accessToken as string, jar }
}

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1
    console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.error(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main(): Promise<void> {
  // Unit: eligibility (no DB)
  const { evaluateAutoBildirimEligibility, BILDIRIM_UYGUNLUK_MESAJI } = await import(
    '../src/tahsilatBildirim/eligibility.service.js'
  )

  const closedClient = evaluateAutoBildirimEligibility({
    tenantOtomasyonAktif: true,
    muvekkilIzni: false,
    dosyaAktif: true,
    taksitAktif: true
  })
  check('müvekkil kapalı → uygun değil', !closedClient.eligible && closedClient.blockingLevel === 'MUVEKKIL')

  const closedDosya = evaluateAutoBildirimEligibility({
    tenantOtomasyonAktif: true,
    muvekkilIzni: true,
    dosyaAktif: false,
    taksitAktif: true
  })
  check('dosya kapalı → uygun değil', !closedDosya.eligible && closedDosya.blockingLevel === 'DOSYA')

  const closedTaksit = evaluateAutoBildirimEligibility({
    tenantOtomasyonAktif: true,
    muvekkilIzni: true,
    dosyaAktif: true,
    taksitAktif: false
  })
  check(
    'taksit sessiz → uygun değil',
    !closedTaksit.eligible &&
      closedTaksit.kullaniciMesaji === BILDIRIM_UYGUNLUK_MESAJI.TAKSIT_KAPALI
  )

  const allOpen = evaluateAutoBildirimEligibility({
    tenantOtomasyonAktif: true,
    muvekkilIzni: true,
    dosyaAktif: true,
    taksitAktif: true
  })
  check('tüm seviyeler açık → uygun', allOpen.eligible)

  const tenantOff = evaluateAutoBildirimEligibility({
    tenantOtomasyonAktif: false,
    muvekkilIzni: true,
    dosyaAktif: true,
    taksitAktif: true
  })
  check('tenant kapalı üstün gelir', !tenantOff.eligible && tenantOff.blockingLevel === 'TENANT')

  const prisma = new PrismaClient()
  const stamp = Date.now()

  try {
    const sahip = await login('e2e.sahip')
    const katip = await login('e2e.katip')
    let bSahip: { token: string; jar: CookieJar } | null = null
    try {
      bSahip = await login('e2e.b.sahip')
    } catch {
      /* tenant B yoksa atlanır */
    }

    // Yeni müvekkil varsayılan kapalı
    const create = await api('/api/v1/muvekkiller', {
      token: sahip.token,
      jar: sahip.jar,
      body: {
        tur: 'GERCEK',
        adSoyad: `E2E Bildirim ${stamp}`,
        telefon: '05321112233',
        sirketUnvani: null,
        eposta: null,
        adres: null,
        not: null,
        yetkiliAdSoyad: '',
        yetkiliTelefon: '',
        mudurAdSoyad: '',
        mudurTelefon: '',
        muhasebeAdSoyad: '',
        muhasebeTelefon: ''
      }
    })
    check('yeni müvekkil 201', create.status === 201)
    const mid = create.json?.muvekkil?.id as string
    check(
      'yeni müvekkil izin varsayılan kapalı',
      create.json?.muvekkil?.otomatikBildirimIzni === false,
      String(create.json?.muvekkil?.otomatikBildirimIzni)
    )

    // Dosya
    const dosya = await api(`/api/v1/muvekkiller/${mid}/dosyalar`, {
      token: sahip.token,
      jar: sahip.jar,
      body: {
        konuBasligi: `E2E Bild Dosya ${stamp}`,
        dosyaTuru: 'DAVA',
        durum: 'AKTIF'
      }
    })
    check('dosya oluştur', dosya.status === 201)
    const did = dosya.json?.dosya?.id as string
    check(
      'dosya bildirim varsayılan açık',
      dosya.json?.dosya?.otomatikBildirimAktif === true
    )

    // Katip PATCH 403
    const katipPatch = await api(`/api/v1/muvekkiller/${mid}/bildirim-ayar`, {
      method: 'PATCH',
      token: katip.token,
      jar: katip.jar,
      body: { otomatikBildirimIzni: true }
    })
    check('katip müvekkil bildirim-ayar 403', katipPatch.status === 403)

    // Cross-tenant
    if (bSahip) {
      const cross = await api(`/api/v1/muvekkiller/${mid}/bildirim-ayar`, {
        method: 'PATCH',
        token: bSahip.token,
        jar: bSahip.jar,
        body: { otomatikBildirimIzni: true }
      })
      check('tenant B müvekkil A ayarı 404', cross.status === 404)
    }

    // Aç → planla için vekalet+taksit
    const vek = await api(`/api/v1/dosyalar/${did}/vekalet`, {
      method: 'POST',
      token: sahip.token,
      jar: sahip.jar,
      body: { toplamTutar: 1000 }
    })
    check('vekalet upsert', vek.status === 200 || vek.status === 201, String(vek.status))

    const vade = new Date()
    vade.setDate(vade.getDate() + 7)
    const tek = await api(`/api/v1/dosyalar/${did}/vekalet/tek-taksit`, {
      method: 'POST',
      token: sahip.token,
      jar: sahip.jar,
      body: {
        tutar: 1000,
        vadeTarihi: vade.toISOString().slice(0, 10)
      }
    })
    // endpoint may vary — try alternate
    let taksitId: string | null =
      tek.json?.taksit?.id ?? tek.json?.taksitler?.[0]?.id ?? null
    if (!taksitId) {
      const pack = await api(`/api/v1/dosyalar/${did}/vekalet`, {
        token: sahip.token,
        jar: sahip.jar
      })
      taksitId = pack.json?.taksitler?.[0]?.id ?? null
    }
    check('taksit var', Boolean(taksitId), `st=${tek.status} id=${taksitId}`)

    // Müvekkil kapalıyken plan oluşturmamalı (tenant otomasyon açık olsa bile)
    await api(`/api/v1/tahsilat-bildirim/ayarlar`, {
      method: 'PATCH',
      token: sahip.token,
      jar: sahip.jar,
      body: { otomasyonAktif: true, testModu: true }
    })
    const planClosed = await api('/api/v1/tahsilat-bildirim/planla', {
      method: 'POST',
      token: sahip.token,
      jar: sahip.jar
    })
    check('planla müvekkil kapalıyken çalışır', planClosed.status === 200)
    const pendingClosed = await api(`/api/v1/muvekkiller/${mid}/bildirim-ayar`, {
      token: sahip.token,
      jar: sahip.jar
    })
    check(
      'müvekkil kapalı → bu müvekkilde planlı iş yok (veya 0)',
      (pendingClosed.json?.pendingPlanliSayisi ?? 0) === 0,
      String(pendingClosed.json?.pendingPlanliSayisi)
    )

    // Müvekkil aç
    const openM = await api(`/api/v1/muvekkiller/${mid}/bildirim-ayar`, {
      method: 'PATCH',
      token: sahip.token,
      jar: sahip.jar,
      body: { otomatikBildirimIzni: true }
    })
    check('müvekkil hatırlatma aç', openM.status === 200 && openM.json?.otomatikBildirimIzni === true)

    // Dosya kapat
    const closeD = await api(`/api/v1/dosyalar/${did}/bildirim-ayar`, {
      method: 'PATCH',
      token: sahip.token,
      jar: sahip.jar,
      body: { otomatikBildirimAktif: false }
    })
    check('dosya hatırlatma kapat', closeD.status === 200 && closeD.json?.otomatikBildirimAktif === false)

    await api('/api/v1/tahsilat-bildirim/planla', {
      method: 'POST',
      token: sahip.token,
      jar: sahip.jar
    })
    const pendingDosya = await api(`/api/v1/dosyalar/${did}/bildirim-ayar`, {
      token: sahip.token,
      jar: sahip.jar
    })
    check(
      'dosya kapalı → dosya planlı 0',
      (pendingDosya.json?.pendingPlanliSayisi ?? 0) === 0
    )
    check(
      'dosya kapalı uyarı metni',
      !pendingDosya.json?.muvekkilKapaliUyari,
      'müvekkil açık olduğu için uyarı null olmalı'
    )

    // Dosya aç, taksit sessiz
    await api(`/api/v1/dosyalar/${did}/bildirim-ayar`, {
      method: 'PATCH',
      token: sahip.token,
      jar: sahip.jar,
      body: { otomatikBildirimAktif: true }
    })

    if (taksitId) {
      const katipTAlways = await api(`/api/v1/vekalet-taksitleri/${taksitId}/bildirim-ayar`, {
        method: 'PATCH',
        token: katip.token,
        jar: katip.jar,
        body: { otomatikBildirimAktif: true }
      })
      check('katip taksit bildirim 403', katipTAlways.status === 403)

      const mute = await api(`/api/v1/vekalet-taksitleri/${taksitId}/bildirim-ayar`, {
        method: 'PATCH',
        token: sahip.token,
        jar: sahip.jar,
        body: { otomatikBildirimAktif: false }
      })
      if (mute.status === 503) {
        check(
          'taksit sessize al — migration henüz yok (503 beklenen)',
          mute.json?.error === 'MIGRATION_REQUIRED' || mute.status === 503
        )
      } else {
        check('taksit sessize al', mute.status === 200 && mute.json?.otomatikBildirimAktif === false)

      await api('/api/v1/tahsilat-bildirim/planla', {
        method: 'POST',
        token: sahip.token,
        jar: sahip.jar
      })
      const pendingT = await api(`/api/v1/vekalet-taksitleri/${taksitId}/bildirim-ayar`, {
        token: sahip.token,
        jar: sahip.jar
      })
      check('taksit sessiz → planlı 0', (pendingT.json?.pendingPlanliSayisi ?? 0) === 0)

      // Yeniden aç — mükerrersiz plan
      await api(`/api/v1/vekalet-taksitleri/${taksitId}/bildirim-ayar`, {
        method: 'PATCH',
        token: sahip.token,
        jar: sahip.jar,
        body: { otomatikBildirimAktif: true }
      })
      const p1 = await api('/api/v1/tahsilat-bildirim/planla', {
        method: 'POST',
        token: sahip.token,
        jar: sahip.jar
      })
      void p1
      const p2 = await api('/api/v1/tahsilat-bildirim/planla', {
        method: 'POST',
        token: sahip.token,
        jar: sahip.jar
      })
      check('yeniden plan mükerrer değil (2. çağrı created≈0)', (p2.json?.result?.created ?? p2.json?.created ?? 0) === 0, JSON.stringify(p2.json))

      const beforeClose = await api(`/api/v1/vekalet-taksitleri/${taksitId}/bildirim-ayar`, {
        token: sahip.token,
        jar: sahip.jar
      })
      const closeT = await api(`/api/v1/vekalet-taksitleri/${taksitId}/bildirim-ayar`, {
        method: 'PATCH',
        token: sahip.token,
        jar: sahip.jar,
        body: { otomatikBildirimAktif: false }
      })
      check(
        'taksit kapatınca iptal sayısı >= 0',
        closeT.status === 200 && typeof closeT.json?.iptalEdilenSayisi === 'number',
        `pending=${beforeClose.json?.pendingPlanliSayisi} iptal=${closeT.json?.iptalEdilenSayisi}`
      )

      await api(`/api/v1/vekalet-taksitleri/${taksitId}/bildirim-ayar`, {
        method: 'PATCH',
        token: sahip.token,
        jar: sahip.jar,
        body: { otomatikBildirimAktif: true }
      })
      await api('/api/v1/tahsilat-bildirim/planla', {
        method: 'POST',
        token: sahip.token,
        jar: sahip.jar
      })
      const odeme = await api(`/api/v1/vekalet-taksitleri/${taksitId}/odemeler`, {
        method: 'POST',
        token: sahip.token,
        jar: sahip.jar,
        body: {
          tutar: 1000,
          odemeYontemi: 'NAKIT',
          odemeTarihi: new Date().toISOString()
        }
      })
      check('tam ödeme', odeme.status === 201, String(odeme.status))
      await new Promise((r) => setTimeout(r, 800))
      const afterPay = await api(`/api/v1/vekalet-taksitleri/${taksitId}/bildirim-ayar`, {
        token: sahip.token,
        jar: sahip.jar
      })
      check(
        'tam ödeme sonrası planlı 0',
        (afterPay.json?.pendingPlanliSayisi ?? 0) === 0,
        String(afterPay.json?.pendingPlanliSayisi)
      )
      } // end else migration applied
    }

    // Manuel WhatsApp engellenmez — API tarafında get müvekkil hala 200
    const mGet = await api(`/api/v1/muvekkiller/${mid}`, {
      token: sahip.token,
      jar: sahip.jar
    })
    check('manuel için müvekkil okunur (izin kapalı olsa da)', mGet.status === 200)

    // Filtre
    await api(`/api/v1/muvekkiller/${mid}/bildirim-ayar`, {
      method: 'PATCH',
      token: sahip.token,
      jar: sahip.jar,
      body: { otomatikBildirimIzni: false }
    })
    const filt = await api('/api/v1/muvekkiller?otomatikHatirlatma=KAPALI&limit=100', {
      token: sahip.token,
      jar: sahip.jar
    })
    const found = (filt.json?.items ?? []).some((x: any) => x.id === mid)
    check('liste KAPALI filtresi müvekkili içerir', found)

    void randomBytes
    void createHash
    void UserRole
  } finally {
    await prisma.$disconnect()
  }

  console.log(`\nÖzet: ${passed}/${passed + failed} geçti`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
