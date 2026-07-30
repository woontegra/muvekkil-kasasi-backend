/**
 * Phase-2 kalite API testleri — yalnızca E2E tenant A/B.
 * Dış servis çağırmaz. Migration uygulamaz.
 *
 *   npx tsx scripts/e2e-provision-phase2.ts
 *   npm run security:quality-phase2
 */
import 'dotenv/config'
import { cookieSecure } from '../src/auth/sessionCookies.js'
import { env } from '../src/config/env.js'

const API = (process.env.E2E_API_URL ?? `http://localhost:${process.env.PORT ?? 4100}`).replace(/\/$/, '')
const PASS = process.env.E2E_PASSWORD ?? process.env.E2E_OWNER_PASSWORD ?? 'E2eTestPass123!'
const ORIGIN = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0]!.trim()

type Check = { name: string; ok: boolean; detail?: string }
const results: Check[] = []

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail })
  console.info(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function api(
  path: string,
  init?: RequestInit & { token?: string }
): Promise<{ status: number; body: any; text: string }> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.body != null) headers.set('Content-Type', 'application/json')
  if (init?.token) headers.set('Authorization', `Bearer ${init.token}`)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  const res = await fetch(`${API}${path}`, { ...init, headers })
  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  return { status: res.status, body, text }
}

async function login(user: string): Promise<{ token: string; tenantId: string; userId: string }> {
  const r = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: user, sifre: PASS })
  })
  if (r.status !== 200 || !r.body?.accessToken) {
    throw new Error(`Login failed for ${user}: ${r.status}`)
  }
  return {
    token: r.body.accessToken as string,
    tenantId: r.body.user.tenantId as string,
    userId: r.body.user.id as string
  }
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function futureYmd(days = 30): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

async function main(): Promise<void> {
  // --- Production oturum ayarları (kod seviyesi; secret yazılmaz) ---
  record('CORS wildcard yok', !env.CORS_ORIGIN.split(',').map((s) => s.trim()).includes('*'))
  record(
    'cookieSecure production kuralı',
    env.NODE_ENV === 'production' ? cookieSecure() === true : cookieSecure() === false,
    `NODE_ENV=${env.NODE_ENV} secure=${cookieSecure()}`
  )
  if (env.NODE_ENV === 'production') {
    record('ADMIN_JWT_SECRET production’da set', Boolean(env.ADMIN_JWT_SECRET))
    record(
      'ADMIN_JWT_SECRET ≠ JWT_SECRET',
      Boolean(env.ADMIN_JWT_SECRET && env.ADMIN_JWT_SECRET !== env.JWT_SECRET)
    )
  } else {
    record('production secret ayrımı (dev’de atlandı)', true, 'skip')
  }

  const a = await login('e2e.sahip')
  const avukat = await login('e2e.avukat')
  const katip = await login('e2e.katip')
  const b = await login('e2e.b.sahip')
  record('Tenant A/B farklı', a.tenantId !== b.tenantId)

  // --- Seed Tenant A dosya ---
  const stamp = Date.now()
  const mA = await api('/api/v1/muvekkiller', {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({
      tur: 'GERCEK',
      adSoyad: `E2E QA Müvekkil ${stamp}`,
      telefon: '05329990001'
    })
  })
  const muvekkilA = mA.body?.muvekkil ?? mA.body
  record('Tenant A müvekkil oluştur', mA.status === 201 || mA.status === 200, `st=${mA.status}`)
  const muvekkilIdA = muvekkilA?.id as string

  const dA = await api(`/api/v1/muvekkiller/${muvekkilIdA}/dosyalar`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({
      konuBasligi: `E2E QA Dosya ${stamp}`,
      dosyaTuru: 'DAVA',
      aciklama: 'Phase2 kalite'
    })
  })
  const dosyaA = dA.body?.dosya ?? dA.body
  const dosyaIdA = dosyaA?.id as string
  record('Tenant A dosya oluştur', Boolean(dosyaIdA), `st=${dA.status}`)

  // Vekalet + tek taksit 1000
  const vek = await api(`/api/v1/dosyalar/${dosyaIdA}/vekalet`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ toplamTutar: 1000 })
  })
  record('vekalet ücreti', vek.status === 200 || vek.status === 201)

  const tek = await api(`/api/v1/dosyalar/${dosyaIdA}/vekalet/tek-taksit`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ vadeTarihi: futureYmd(), tutar: 1000 })
  })
  const taksitId = tek.body?.taksit?.id as string
  record('tek taksit', Boolean(taksitId), `st=${tek.status}`)

  // Kısmi 1: 300
  const o1 = await api(`/api/v1/vekalet-taksitleri/${taksitId}/odemeler`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tutar: 300, odemeYontemi: 'NAKIT', odemeTarihi: todayYmd() })
  })
  record('kısmi ödeme 1', o1.status === 201 || o1.status === 200)
  const after1 = o1.body?.taksit ?? o1.body
  const durum1 = after1?.odemeDurumu ?? after1?.durum
  const kalan1 = Number(after1?.kalanTutar ?? NaN)
  const odenen1 = Number(after1?.odenenToplam ?? NaN)
  record('KISMI_ODENDI (1)', durum1 === 'KISMI_ODENDI' || after1?.durum === 'KISMI_ODENDI' || after1?.durum === 'GECIKTI', `d=${durum1}/${after1?.durum}`)
  record('kalan 700 (1)', Math.abs(kalan1 - 700) < 0.02 && Math.abs(odenen1 - 300) < 0.02, `kalan=${kalan1} odenen=${odenen1}`)

  // Kısmi 2: 200
  const o2 = await api(`/api/v1/vekalet-taksitleri/${taksitId}/odemeler`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tutar: 200, odemeYontemi: 'BANKA', odemeTarihi: todayYmd() })
  })
  record('kısmi ödeme 2', o2.status === 201 || o2.status === 200)
  const after2 = o2.body?.taksit ?? o2.body
  record(
    'KISMI_ODENDI (2) kalan 500',
    (after2?.odemeDurumu === 'KISMI_ODENDI' || after2?.durum === 'KISMI_ODENDI' || after2?.durum === 'GECIKTI') &&
      Math.abs(Number(after2?.kalanTutar) - 500) < 0.05,
    `d=${after2?.odemeDurumu}/${after2?.durum} kalan=${after2?.kalanTutar}`
  )

  // Son ödeme 500 → ODENDI
  const o3 = await api(`/api/v1/vekalet-taksitleri/${taksitId}/odemeler`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tutar: 500, odemeYontemi: 'NAKIT', odemeTarihi: todayYmd() })
  })
  record('son ödeme', o3.status === 201 || o3.status === 200)
  const after3 = o3.body?.taksit ?? o3.body
  record('ODENDI', after3?.odemeDurumu === 'ODENDI' || after3?.durum === 'ODENDI', `d=${after3?.odemeDurumu}/${after3?.durum}`)

  const listO = await api(`/api/v1/vekalet-taksitleri/${taksitId}/odemeler`, { token: a.token })
  const odemeler: any[] = listO.body?.items ?? listO.body?.odemeler ?? []
  record('3 ödeme kaydı', Array.isArray(odemeler) && odemeler.length >= 3, `n=${odemeler.length}`)

  // Düzenle ilk ödemeyi 250’ye
  const odemeEditId = odemeler[0]?.id
  const upd = await api(`/api/v1/vekalet-taksit-odemeleri/${odemeEditId}`, {
    method: 'PUT',
    token: a.token,
    body: JSON.stringify({ tutar: 250 })
  })
  record('ödeme düzenle', upd.status === 200)

  const packAfterEdit = await api(`/api/v1/dosyalar/${dosyaIdA}/vekalet`, { token: a.token })
  const taksitAfterEdit = (packAfterEdit.body?.taksitler ?? []).find((t: any) => t.id === taksitId)
  record(
    'düzenleme sonrası kalan tutarlı',
    taksitAfterEdit != null && Number(taksitAfterEdit.kalanTutar) > 0,
    `kalan=${taksitAfterEdit?.kalanTutar} durum=${taksitAfterEdit?.durum}`
  )

  // Sil bir ödeme
  const listO2 = await api(`/api/v1/vekalet-taksitleri/${taksitId}/odemeler`, { token: a.token })
  const odList: any[] = listO2.body?.items ?? []
  const toDel = odList.find((o: any) => o.id !== odemeEditId)?.id ?? odList[0]?.id
  const del = await api(`/api/v1/vekalet-taksit-odemeleri/${toDel}`, {
    method: 'DELETE',
    token: a.token
  })
  record('ödeme sil', del.status === 200 || del.status === 204)

  // Aggregate sayfalar
  for (const [name, path] of [
    ['mali özet', `/api/v1/dosyalar/${dosyaIdA}/mali-ozet`],
    ['ekstre', `/api/v1/dosyalar/${dosyaIdA}/muvekkil-ekstresi?itibariyleTarih=${todayYmd()}`],
    ['kasa özet', `/api/v1/dosyalar/${dosyaIdA}/kasa-ozet`]
  ] as const) {
    const r1 = await api(path, { token: a.token })
    const r2 = await api(path, { token: a.token })
    let same = r1.status === 200 && r2.status === 200
    if (name === 'ekstre') {
      const e1 = r1.body?.ekstre
      const e2 = r2.body?.ekstre
      same =
        same &&
        e1?.masrafAvansiOzeti?.guncelBakiye === e2?.masrafAvansiOzeti?.guncelBakiye &&
        e1?.vekaletOzeti?.kalanToplam === e2?.vekaletOzeti?.kalanToplam &&
        e1?.muvekkil?.id === e2?.muvekkil?.id
    } else if (name === 'kasa özet') {
      same = same && JSON.stringify(r1.body?.ozet) === JSON.stringify(r2.body?.ozet)
    } else {
      same = same && JSON.stringify(r1.body) === JSON.stringify(r2.body)
    }
    record(`${name} tutarlı (çift okuma)`, same)
  }

  // Edge: aşırı / negatif / sıfır / kalan üstü
  const over = await api(`/api/v1/vekalet-taksitleri/${taksitId}/odemeler`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tutar: 999999, odemeYontemi: 'NAKIT' })
  })
  record('aşırı tutar reddi', over.status === 400)

  const neg = await api(`/api/v1/vekalet-taksitleri/${taksitId}/odemeler`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tutar: -10, odemeYontemi: 'NAKIT' })
  })
  record('negatif tutar reddi', neg.status === 400)

  const zero = await api(`/api/v1/vekalet-taksitleri/${taksitId}/odemeler`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tutar: 0, odemeYontemi: 'NAKIT' })
  })
  record('sıfır tutar reddi', zero.status === 400)

  // Concurrent: yeni tek taksit dosyası
  const mC = await api('/api/v1/muvekkiller', {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tur: 'GERCEK', adSoyad: `E2E Conc ${stamp}`, telefon: '05329990002' })
  })
  const midC = (mC.body?.muvekkil ?? mC.body)?.id
  const dC = await api(`/api/v1/muvekkiller/${midC}/dosyalar`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ konuBasligi: `E2E Conc Dosya ${stamp}`, dosyaTuru: 'DAVA' })
  })
  const didC = (dC.body?.dosya ?? dC.body)?.id
  await api(`/api/v1/dosyalar/${didC}/vekalet`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ toplamTutar: 100 })
  })
  const tC = await api(`/api/v1/dosyalar/${didC}/vekalet/tek-taksit`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ vadeTarihi: futureYmd(), tutar: 100 })
  })
  const tidC = tC.body?.taksit?.id
  const concurrent = await Promise.all([
    api(`/api/v1/vekalet-taksitleri/${tidC}/odemeler`, {
      method: 'POST',
      token: a.token,
      body: JSON.stringify({ tutar: 80, odemeYontemi: 'NAKIT' })
    }),
    api(`/api/v1/vekalet-taksitleri/${tidC}/odemeler`, {
      method: 'POST',
      token: a.token,
      body: JSON.stringify({ tutar: 80, odemeYontemi: 'BANKA' })
    })
  ])
  const okC = concurrent.filter((x) => x.status === 200 || x.status === 201).length
  const failC = concurrent.filter((x) => x.status >= 400).length
  record('eşzamanlı çift ödeme aşımı engeli', okC === 1 && failC >= 1, `ok=${okC} fail=${failC}`)
  const packC = await api(`/api/v1/dosyalar/${didC}/vekalet`, { token: a.token })
  const tAfter = (packC.body?.taksitler ?? []).find((t: any) => t.id === tidC)
  const odenenC = Number(tAfter?.odenenToplam ?? 0)
  record('eşzamanlı sonrası odenen ≤ 100', odenenC <= 100.01, `odenen=${odenenC}`)

  // --- Kasa / avans ---
  const avans = await api(`/api/v1/dosyalar/${dosyaIdA}/kasa-hareketleri`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tip: 'AVANS_GIRISI', tarih: todayYmd(), tutar: 500, aciklama: 'E2E avans' })
  })
  const avansId = (avans.body?.kasaHareketi ?? avans.body)?.id
  record('avans oluştur (ONAYSIZ)', avans.status === 201 || avans.status === 200)

  const ozet1 = await api(`/api/v1/dosyalar/${dosyaIdA}/kasa-ozet`, { token: a.token })
  const bakiyeOnaysiz = Number(ozet1.body?.ozet?.bakiye ?? 0)
  const avansOnaysiz = Number(ozet1.body?.ozet?.toplamAvans ?? 0)
  record('ONAYSIZ avans bakiyeye girmez', Math.abs(bakiyeOnaysiz) < 0.01 && Math.abs(avansOnaysiz) < 0.01, `bakiye=${bakiyeOnaysiz}`)

  const onayAvans = await api(`/api/v1/kasa-hareketleri/${avansId}/onayla`, {
    method: 'POST',
    token: a.token
  })
  record('avans onay', onayAvans.status === 200)

  const masraf = await api(`/api/v1/dosyalar/${dosyaIdA}/kasa-hareketleri`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({
      tip: 'MASRAF',
      tarih: todayYmd(),
      tutar: 100,
      masrafTuru: 'Harç',
      masrafiYapanKisi: 'E2E Test',
      aciklama: 'E2E masraf'
    })
  })
  const masrafId = (masraf.body?.kasaHareketi ?? masraf.body)?.id
  record('masraf oluştur', masraf.status === 201 || masraf.status === 200)
  await api(`/api/v1/kasa-hareketleri/${masrafId}/onayla`, { method: 'POST', token: a.token })

  // Pozitif düzeltme (orijinal onaylı masraf veya avans)
  const duzPos = await api(`/api/v1/kasa-hareketleri/${avansId}/duzeltme`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tutar: 50, aciklama: 'E2E +düzeltme', tarih: todayYmd() })
  })
  const duzPosId = (duzPos.body?.kasaHareketi ?? duzPos.body)?.id
  record('pozitif düzeltme oluştur', duzPos.status === 201 || duzPos.status === 200)
  if (duzPosId) {
    await api(`/api/v1/kasa-hareketleri/${duzPosId}/onayla`, { method: 'POST', token: a.token })
  }

  const duzNeg = await api(`/api/v1/kasa-hareketleri/${avansId}/duzeltme`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tutar: -30, aciklama: 'E2E -düzeltme iade', tarih: todayYmd() })
  })
  const duzNegId = (duzNeg.body?.kasaHareketi ?? duzNeg.body)?.id
  record('negatif düzeltme oluştur', duzNeg.status === 201 || duzNeg.status === 200)
  if (duzNegId) {
    await api(`/api/v1/kasa-hareketleri/${duzNegId}/onayla`, { method: 'POST', token: a.token })
  }

  const ozet2 = await api(`/api/v1/dosyalar/${dosyaIdA}/kasa-ozet`, { token: a.token })
  const av = Number(ozet2.body?.ozet?.toplamAvans ?? NaN)
  const ms = Number(ozet2.body?.ozet?.toplamMasraf ?? NaN)
  const dz = Number(ozet2.body?.ozet?.toplamDuzeltme ?? NaN)
  const bk = Number(ozet2.body?.ozet?.bakiye ?? NaN)
  const expected = av - ms + dz
  record(
    'bakiye = avans - masraf + düzeltme',
    Number.isFinite(bk) && Math.abs(bk - expected) < 0.05,
    `av=${av} ms=${ms} dz=${dz} bk=${bk} exp=${expected}`
  )

  // Çift onay
  const doubleOnay = await api(`/api/v1/kasa-hareketleri/${avansId}/onayla`, {
    method: 'POST',
    token: a.token
  })
  record('çift onay engeli', doubleOnay.status === 400 || doubleOnay.status === 409 || doubleOnay.status === 403)

  // Red / sil
  const redH = await api(`/api/v1/dosyalar/${dosyaIdA}/kasa-hareketleri`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tip: 'AVANS_GIRISI', tarih: todayYmd(), tutar: 10, aciklama: 'red-test' })
  })
  const redId = (redH.body?.kasaHareketi ?? redH.body)?.id
  const red = await api(`/api/v1/kasa-hareketleri/${redId}/reddet`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ redSebebi: 'E2E red' })
  })
  record('reddet', red.status === 200)

  const silH = await api(`/api/v1/dosyalar/${dosyaIdA}/kasa-hareketleri`, {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ tip: 'AVANS_GIRISI', tarih: todayYmd(), tutar: 11, aciklama: 'sil-test' })
  })
  const silId = (silH.body?.kasaHareketi ?? silH.body)?.id
  const sil = await api(`/api/v1/kasa-hareketleri/${silId}`, { method: 'DELETE', token: a.token })
  record('ONAYSIZ sil', sil.status === 204 || sil.status === 200)

  // --- Rol matrisi ---
  const maliKontrolKatip = await api('/api/v1/mali-kontrol/uyarilar', { token: katip.token })
  record('katip mali kontrol engelli', maliKontrolKatip.status === 403 || maliKontrolKatip.status === 401)

  const maliKontrolAvukat = await api('/api/v1/mali-kontrol/uyarilar', { token: avukat.token })
  record('avukat mali kontrol OK veya boş', maliKontrolAvukat.status === 200 || maliKontrolAvukat.status === 404)

  const usersKatip = await api('/api/v1/users', { token: katip.token })
  record('katip users list engelli', usersKatip.status === 403)

  const usersAvukat = await api('/api/v1/users', { token: avukat.token })
  record('avukat users list (mevcut kural)', usersAvukat.status === 200 || usersAvukat.status === 403)

  const createUserKatip = await api('/api/v1/users', {
    method: 'POST',
    token: katip.token,
    body: JSON.stringify({
      adSoyad: 'X',
      kullaniciAdi: `e2e.x.${stamp}`,
      sifre: 'TempPass123!',
      rol: 'KATIP_PERSONEL'
    })
  })
  record('katip user create engelli', createUserKatip.status === 403)

  const onayKatip = await api(`/api/v1/kasa-hareketleri/${masrafId}/onayla`, {
    method: 'POST',
    token: katip.token
  })
  record('katip kasa onay engelli', onayKatip.status === 403)

  const vekaletKatip = await api(`/api/v1/dosyalar/${dosyaIdA}/vekalet`, {
    method: 'POST',
    token: katip.token,
    body: JSON.stringify({ toplamTutar: 1 })
  })
  record('katip vekalet upsert engelli', vekaletKatip.status === 403)

  const odemeKatip = await api(`/api/v1/vekalet-taksitleri/${taksitId}/odemeler`, {
    method: 'POST',
    token: katip.token,
    body: JSON.stringify({ tutar: 1, odemeYontemi: 'NAKIT' })
  })
  record(
    'katip ödeme (ürün kuralı)',
    odemeKatip.status === 200 || odemeKatip.status === 201 || odemeKatip.status === 400,
    `st=${odemeKatip.status}`
  )

  // --- Tenant izolasyonu ---
  const mB = await api('/api/v1/muvekkiller', {
    method: 'POST',
    token: b.token,
    body: JSON.stringify({ tur: 'GERCEK', adSoyad: `E2E B Müvekkil ${stamp}`, telefon: '05329990003' })
  })
  const midB = (mB.body?.muvekkil ?? mB.body)?.id as string
  const dB = await api(`/api/v1/muvekkiller/${midB}/dosyalar`, {
    method: 'POST',
    token: b.token,
    body: JSON.stringify({ konuBasligi: `E2E B Dosya ${stamp}`, dosyaTuru: 'DAVA' })
  })
  const didB = (dB.body?.dosya ?? dB.body)?.id as string
  await api(`/api/v1/dosyalar/${didB}/vekalet`, {
    method: 'POST',
    token: b.token,
    body: JSON.stringify({ toplamTutar: 200 })
  })
  const tB = await api(`/api/v1/dosyalar/${didB}/vekalet/tek-taksit`, {
    method: 'POST',
    token: b.token,
    body: JSON.stringify({ vadeTarihi: futureYmd(), tutar: 200 })
  })
  const tidB = tB.body?.taksit?.id
  const oB = await api(`/api/v1/vekalet-taksitleri/${tidB}/odemeler`, {
    method: 'POST',
    token: b.token,
    body: JSON.stringify({ tutar: 50, odemeYontemi: 'NAKIT' })
  })
  void oB
  const oidB = await api(`/api/v1/vekalet-taksitleri/${tidB}/odemeler`, { token: b.token })
  const odemeB = (oidB.body?.items ?? [])[0]?.id
  const kB = await api(`/api/v1/dosyalar/${didB}/kasa-hareketleri`, {
    method: 'POST',
    token: b.token,
    body: JSON.stringify({ tip: 'AVANS_GIRISI', tarih: todayYmd(), tutar: 20, aciklama: 'B avans' })
  })
  const kidB = (kB.body?.kasaHareketi ?? kB.body)?.id

  const crossChecks: Array<[string, string, RequestInit]> = [
    ['A→B müvekkil GET', `/api/v1/muvekkiller/${midB}`, { token: a.token } as any],
    ['A→B dosya GET', `/api/v1/dosyalar/${didB}`, { token: a.token } as any],
    ['A→B taksit ödemeler', `/api/v1/vekalet-taksitleri/${tidB}/odemeler`, { token: a.token } as any],
    ['A→B ödeme PUT', `/api/v1/vekalet-taksit-odemeleri/${odemeB}`, { method: 'PUT', token: a.token, body: JSON.stringify({ tutar: 1 }) } as any],
    ['A→B kasa onay', `/api/v1/kasa-hareketleri/${kidB}/onayla`, { method: 'POST', token: a.token } as any],
    ['A→B mali özet', `/api/v1/dosyalar/${didB}/mali-ozet`, { token: a.token } as any],
    ['A→B ekstre', `/api/v1/dosyalar/${didB}/muvekkil-ekstresi?itibariyleTarih=${todayYmd()}`, { token: a.token } as any],
    [
      'A body tenantId spoof müvekkil',
      '/api/v1/muvekkiller',
      {
        method: 'POST',
        token: a.token,
        body: JSON.stringify({
          tur: 'GERCEK',
          adSoyad: `Spoof ${stamp}`,
          telefon: '05329990004',
          tenantId: b.tenantId
        })
      } as any
    ]
  ]

  for (const [name, path, init] of crossChecks) {
    const r = await api(path, init as any)
    const leak =
      r.text.includes(midB) && name.includes('spoof')
        ? false
        : /"adSoyad"\s*:\s*"E2E B|"buroAdi"\s*:\s*"E2E Phase2 Büro B/.test(r.text)
    const okStatus = r.status === 403 || r.status === 404 || (name.includes('spoof') && (r.status === 200 || r.status === 201))
    if (name.includes('spoof') && (r.status === 200 || r.status === 201)) {
      const createdTenant = r.body?.muvekkil?.tenantId ?? r.body?.tenantId
      record(name, createdTenant === a.tenantId || createdTenant == null, `st=${r.status}`)
    } else {
      record(name, okStatus && !leak, `st=${r.status}`)
    }
  }

  // B kullanıcısı A kullanıcısı id
  const usersA = await api('/api/v1/users', { token: a.token })
  const otherUserId = (usersA.body?.items ?? []).find((u: any) => u.kullaniciAdi === 'e2e.katip')?.id
  if (otherUserId) {
    const crossUser = await api(`/api/v1/users/${otherUserId}`, { token: b.token })
    record('B→A kullanıcı GET engelli', crossUser.status === 403 || crossUser.status === 404)
  } else {
    record('B→A kullanıcı GET (atlandı)', true, 'skip')
  }

  const failed = results.filter((r) => !r.ok)
  console.info(`\nÖzet: ${results.length - failed.length}/${results.length} geçti`)
  if (failed.length) {
    console.info('Başarısız:')
    for (const f of failed) console.info(` - ${f.name}${f.detail ? ` (${f.detail})` : ''}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
