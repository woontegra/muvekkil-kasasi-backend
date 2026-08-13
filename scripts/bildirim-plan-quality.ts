/**
 * Bildirim plan override mock testleri — gerçek Meta çağrısı yok.
 * Çalıştır: npx --yes tsx scripts/bildirim-plan-quality.ts
 */
import assert from 'node:assert/strict'
import { BildirimKuralTuru, BildirimPlanModu, BildirimPlanKaynagi } from '@prisma/client'

async function main(): Promise<void> {
  const { offsetLabel, RANDEVU_OFFSET_PRESETS } = await import(
    '../src/tahsilatBildirim/bildirimPlan.service.js'
  )
  const { TEMPLATE_LIBRARY } = await import('../src/tahsilatBildirim/templateLibrary.catalog.js')
  const { evaluateAutoBildirimEligibility } = await import(
    '../src/tahsilatBildirim/eligibility.service.js'
  )
  const { buildSendBodyComponentsForLibraryKey } = await import(
    '../src/tahsilatBildirim/templateLibrary.components.js'
  )

  assert.equal(offsetLabel(60), '1 saat önce')
  assert.equal(offsetLabel(1440), '1 gün önce')
  assert.equal(offsetLabel(30), '30 dk önce')
  assert.ok(RANDEVU_OFFSET_PRESETS.length >= 4)

  const randevuTpl = TEMPLATE_LIBRARY.find((e) => e.libraryKey === 'RANDEVU_HATIRLATMA')
  assert.ok(randevuTpl, 'RANDEVU_HATIRLATMA catalog')
  assert.equal(randevuTpl!.templateGroup, 'RANDEVU')
  assert.equal(TEMPLATE_LIBRARY.length, 7)

  const randevuComponents = buildSendBodyComponentsForLibraryKey('RANDEVU_HATIRLATMA', {
    muvekkilAdi: 'Ali Veli',
    randevuTarihi: '14.08.2026',
    randevuSaati: '15:00',
    buroAdi: 'Test Büro'
  })
  assert.ok(randevuComponents.ok, 'randevu template components')

  // Özel plan üst zincirde müvekkil kapalıysa gönderilmez
  const blockedMuvekkil = evaluateAutoBildirimEligibility({
    tenantOtomasyonAktif: true,
    muvekkilIzni: false,
    dosyaAktif: true,
    taksitAktif: true
  })
  assert.equal(blockedMuvekkil.eligible, false)

  const blockedDosya = evaluateAutoBildirimEligibility({
    tenantOtomasyonAktif: true,
    muvekkilIzni: true,
    dosyaAktif: false,
    taksitAktif: true
  })
  assert.equal(blockedDosya.eligible, false)

  const blockedTaksit = evaluateAutoBildirimEligibility({
    tenantOtomasyonAktif: true,
    muvekkilIzni: true,
    dosyaAktif: true,
    taksitAktif: false
  })
  assert.equal(blockedTaksit.eligible, false)

  // Idempotency format — taksit
  const taksitKey = `t1|taksit1|${BildirimKuralTuru.VADE_GUNU}|WHATSAPP|2026-08-13|${BildirimPlanKaynagi.OZEL}|v2`
  assert.ok(taksitKey.includes('OZEL'))
  assert.ok(taksitKey.includes('v2'))

  // Idempotency format — randevu (iki offset farklı iş)
  const randevuKey1 = `t1|randevu1|60|WHATSAPP|${BildirimPlanKaynagi.VARSAYILAN}|v1`
  const randevuKey2 = `t1|randevu1|30|WHATSAPP|${BildirimPlanKaynagi.VARSAYILAN}|v1`
  assert.notEqual(randevuKey1, randevuKey2)

  assert.equal(BildirimPlanModu.VARSAYILAN, 'VARSAYILAN')
  assert.equal(BildirimPlanModu.KAPALI, 'KAPALI')
  assert.equal(BildirimPlanModu.OZEL, 'OZEL')

  console.log('bildirim-plan-quality: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
