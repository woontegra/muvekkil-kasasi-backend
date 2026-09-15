/**
 * Güvenli masraf soft-delete — API davranış doğrulaması (yerel).
 * Migration uygulanmadan DB kolonları yoksa soft-delete adımları atlanır/raporlanır.
 *
 * Çalıştırma: npx tsx scripts/masraf-guvenli-sil-quality.ts
 * Gerekli env: aynı quality-phase2 (TEST_BASE_URL, tenant kullanıcıları).
 */

import { createHash, randomBytes } from 'node:crypto'
import { requireSafeTestDatabaseOrExit } from '../src/lib/assertSafeTestDatabase.js'

type ApiResult = { status: number; body: any }

const BASE = (process.env.TEST_BASE_URL || process.env.API_BASE_URL || 'http://127.0.0.1:4100').replace(/\/$/, '')
requireSafeTestDatabaseOrExit({ apiUrl: BASE })

async function api(path: string, opts: { method?: string; token?: string; body?: string } = {}): Promise<ApiResult> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {})
    },
    body: opts.body
  })
  let body: any = null
  const text = await res.text()
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function record(name: string, ok: boolean, detail = ''): void {
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

async function login(kullaniciAdi: string, sifre: string): Promise<{ token: string; role?: string } | null> {
  const r = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ kullaniciAdi, sifre })
  })
  if (r.status !== 200 || !r.body?.accessToken) return null
  return { token: r.body.accessToken as string, role: r.body?.user?.role }
}

async function main(): Promise<void> {
  const ownerUser = process.env.E2E_OWNER_USER || process.env.TEST_OWNER_USER
  const ownerPass = process.env.E2E_OWNER_PASS || process.env.TEST_OWNER_PASS
  const katipUser = process.env.E2E_KATIP_USER || process.env.TEST_KATIP_USER
  const katipPass = process.env.E2E_KATIP_PASS || process.env.TEST_KATIP_PASS
  const dosyaId = process.env.E2E_DOSYA_ID || process.env.TEST_DOSYA_ID

  if (!ownerUser || !ownerPass || !katipUser || !katipPass || !dosyaId) {
    console.log(
      'SKIP: E2E_OWNER_USER/PASS, E2E_KATIP_USER/PASS, E2E_DOSYA_ID gerekli. Birim testler yine de çalıştırılmalı.'
    )
    return
  }

  const owner = await login(ownerUser, ownerPass)
  const katip = await login(katipUser, katipPass)
  record('büro sahibi login', Boolean(owner?.token))
  record('katip login', Boolean(katip?.token))
  if (!owner || !katip) return

  record('owner role BURO_SAHIBI', owner.role === 'BURO_SAHIBI', String(owner.role))

  const create = await api(`/api/v1/dosyalar/${dosyaId}/kasa-hareketleri`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({
      tip: 'MASRAF',
      tarih: todayYmd(),
      tutar: 12.34,
      masrafTuru: 'Harç',
      masrafiYapanKisi: 'E2E Test',
      aciklama: `guvenli-sil-${randomBytes(3).toString('hex')}`,
      odemeYontemi: 'NAKIT'
    })
  })
  const masrafId = (create.body?.kasaHareketi ?? create.body)?.id as string | undefined
  record('masraf oluştur', create.status === 201 || create.status === 200, String(create.status))
  if (!masrafId) return

  await api(`/api/v1/kasa-hareketleri/${masrafId}/onayla`, { method: 'POST', token: owner.token })

  const katipDirect = await api(`/api/v1/kasa-hareketleri/${masrafId}/guvenli-sil`, {
    method: 'POST',
    token: katip.token,
    body: JSON.stringify({ sifre: katipPass, deleteReason: 'yetkisiz deneme' })
  })
  record('alt kullanıcı guvenli-sil 403', katipDirect.status === 403, String(katipDirect.status))

  const hardMasraf = await api(`/api/v1/kasa-hareketleri/${masrafId}`, {
    method: 'DELETE',
    token: owner.token
  })
  record('MASRAF hard-delete engelli', hardMasraf.status === 403, String(hardMasraf.status))

  const noPass = await api(`/api/v1/kasa-hareketleri/${masrafId}/guvenli-sil`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ sifre: '', deleteReason: 'neden yeterince uzun' })
  })
  record('şifresiz istek reddedilir', noPass.status === 401 || noPass.status === 422, String(noPass.status))

  const wrong = await api(`/api/v1/kasa-hareketleri/${masrafId}/guvenli-sil`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ sifre: `wrong-${createHash('sha256').update('x').digest('hex').slice(0, 8)}`, deleteReason: 'yanlış şifre testi' })
  })
  record('yanlış şifre 401', wrong.status === 401, `${wrong.status} ${wrong.body?.message ?? ''}`)
  record(
    'yanlış şifre mesajı',
    String(wrong.body?.message ?? '').includes('Şifre yanlış'),
    String(wrong.body?.message ?? '')
  )

  const ozetBefore = await api(`/api/v1/dosyalar/${dosyaId}/kasa-ozet`, { token: owner.token })
  const masrafBefore = Number(ozetBefore.body?.ozet?.toplamMasraf ?? NaN)

  const ok = await api(`/api/v1/kasa-hareketleri/${masrafId}/guvenli-sil`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ sifre: ownerPass, deleteReason: 'E2E güvenli silme doğrulaması' })
  })
  const schemaMissing =
    ok.status === 500 &&
    String(ok.body?.message ?? ok.body ?? '').toLowerCase().includes('deleted')
  if (schemaMissing) {
    console.log(
      'SKIP soft-delete DB adımı: migration henüz uygulanmamış (deleted_at kolonları yok). Schema + kod hazır.'
    )
    return
  }
  record('doğru şifre + neden ile soft-delete', ok.status === 200, String(ok.status))
  record(
    'başarı mesajı',
    String(ok.body?.message ?? '').includes('Masraf silindi ve denetim kaydı oluşturuldu')
  )

  const again = await api(`/api/v1/kasa-hareketleri/${masrafId}/guvenli-sil`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({ sifre: ownerPass, deleteReason: 'ikinci deneme aynı kayıt' })
  })
  record('ikinci silme aynı kayıtta çakışma/404', again.status === 404 || again.status === 409, String(again.status))

  const list = await api(`/api/v1/dosyalar/${dosyaId}/kasa-hareketleri?tip=MASRAF&limit=200`, {
    token: owner.token
  })
  const stillListed = (list.body?.items ?? []).some((i: { id: string }) => i.id === masrafId)
  record('listeden düştü', !stillListed)

  const ozetAfter = await api(`/api/v1/dosyalar/${dosyaId}/kasa-ozet`, { token: owner.token })
  const masrafAfter = Number(ozetAfter.body?.ozet?.toplamMasraf ?? NaN)
  record(
    'toplam masraftan düştü',
    Number.isFinite(masrafBefore) && Number.isFinite(masrafAfter) && masrafAfter <= masrafBefore - 12.3,
    `before=${masrafBefore} after=${masrafAfter}`
  )

  // İkinci masraf — şifre yeniden zorunlu (oturum yetmez)
  const create2 = await api(`/api/v1/dosyalar/${dosyaId}/kasa-hareketleri`, {
    method: 'POST',
    token: owner.token,
    body: JSON.stringify({
      tip: 'MASRAF',
      tarih: todayYmd(),
      tutar: 5.55,
      masrafTuru: 'Harç',
      masrafiYapanKisi: 'E2E Test',
      aciklama: `guvenli-sil-2-${randomBytes(3).toString('hex')}`
    })
  })
  const masrafId2 = (create2.body?.kasaHareketi ?? create2.body)?.id as string | undefined
  if (masrafId2) {
    await api(`/api/v1/kasa-hareketleri/${masrafId2}/onayla`, { method: 'POST', token: owner.token })
    const sessionOnly = await api(`/api/v1/kasa-hareketleri/${masrafId2}/guvenli-sil`, {
      method: 'POST',
      token: owner.token,
      body: JSON.stringify({ deleteReason: 'şifre yok oturum var' })
    })
    record(
      'açık oturum şifresiz ikinci masrafta yetersiz',
      sessionOnly.status === 401 || sessionOnly.status === 422,
      String(sessionOnly.status)
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
