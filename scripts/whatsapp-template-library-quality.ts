/**
 * Hazır şablon kütüphanesi — mock only (gerçek Meta create yok).
 */
import {
  TEMPLATE_LIBRARY,
  getLibraryEntry,
  libraryStatusLabel,
  suggestedLibraryKeyForKural
} from '../src/tahsilatBildirim/templateLibrary.catalog.js'
import {
  buildMetaCreateTemplatePayload,
  buildSendBodyComponentsFromVars,
  buildSendBodyComponentsForLibraryKey
} from '../src/tahsilatBildirim/templateLibrary.components.js'
import {
  normalizeMetaTemplateStatus,
  normalizeMetaRejectionReason
} from '../src/tahsilatBildirim/meta/embeddedSignup.js'
import {
  ATLAMA_TEMPLATE_DEGISKEN_EKSIK,
  ATLAMA_TEMPLATE_GEREKLI,
  ATLAMA_UYGUN_TEMPLATE_YOK
} from '../src/tahsilatBildirim/worker.service.js'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function main() {
  assert(TEMPLATE_LIBRARY.length === 7, 'catalog has 7 templates')
  assert(
    TEMPLATE_LIBRARY.every((e) => e.category === 'UTILITY' && e.language === 'tr'),
    'utility tr'
  )
  assert(TEMPLATE_LIBRARY.every((e) => e.parameterFormat === 'positional'), 'positional catalog')
  assert(suggestedLibraryKeyForKural('VADEDEN_ONCE') === 'TAHSILAT_VADE_ONCESI', 'map once')
  assert(suggestedLibraryKeyForKural('VADE_GUNU') === 'TAHSILAT_VADE_GUNU', 'map gun')
  assert(suggestedLibraryKeyForKural('VADE_SONRASI') === 'TAHSILAT_GECIKMIS', 'map gecikmis')

  const entry = getLibraryEntry('TAHSILAT_GECIKMIS')!
  const createPayload = buildMetaCreateTemplatePayload(entry)
  assert(!('parameter_format' in createPayload), 'omit parameter_format')
  assert(createPayload.name === 'mk_tahsilat_gecikmis_v1', 'meta name')
  const comps = createPayload.components as Array<{
    type: string
    text: string
    example: { body_text: string[][] }
  }>
  assert(comps[0]?.type === 'BODY', 'BODY component')
  assert(comps[0]?.text.includes('{{1}}'), 'positional 1')
  assert(comps[0]?.text.includes('{{6}}'), 'positional 6')
  assert(Array.isArray(comps[0]?.example.body_text?.[0]), 'nested body_text')
  assert(comps[0]!.example.body_text[0]!.length === entry.variables.length, 'example count')

  const vars = {
    muvekkilAdi: 'Ayşe',
    dosyaBilgisi: 'Dosya A',
    vadeTarihi: '01.01.2026',
    kalanTutar: '2500.00',
    gecikmeGunu: '5',
    buroAdi: 'Büro'
  }
  const send = buildSendBodyComponentsFromVars(entry, vars)
  assert(send.ok === true, 'send components ok')
  if (send.ok) {
    const params = send.components[0]!.parameters
    assert(params.length === entry.variables.length, 'param count')
    assert(!('parameter_name' in params[0]!), 'positional send')
    assert(params[0]!.text === 'Ayşe', 'first text')
    assert(params[3]!.text === '2500.00', 'kalan ordered')
    assert(params[4]!.text === '5', 'gecikme ordered')
  }

  const missing = buildSendBodyComponentsForLibraryKey('TAHSILAT_GECIKMIS', {
    muvekkilAdi: 'Ayşe'
  })
  assert(missing.ok === false && missing.code === 'TEMPLATE_DEGISKEN_EKSIK', 'missing vars')
  assert(!('components' in missing && (missing as { components?: unknown }).components), 'no components on miss')

  assert(normalizeMetaTemplateStatus('APPROVED') === 'ONAYLANDI', 'approved')
  assert(normalizeMetaTemplateStatus('PENDING') === 'BEKLIYOR', 'pending')
  assert(normalizeMetaTemplateStatus('REJECTED') === 'REDDEDILDI', 'rejected')
  assert(normalizeMetaTemplateStatus('PAUSED') === 'DURAKLATILDI', 'paused')
  assert(normalizeMetaTemplateStatus('DISABLED') === 'DEVRE_DISI', 'disabled')
  assert(normalizeMetaRejectionReason('INVALID_FORMAT') === 'INVALID_FORMAT', 'reject reason')
  assert(libraryStatusLabel(null).label === 'Henüz gönderilmedi', 'not created')
  assert(libraryStatusLabel('ONAYLANDI').label === 'Onaylandı', 'approved label')
  assert(libraryStatusLabel('REDDEDILDI').label === 'Reddedildi', 'rejected label')

  assert(ATLAMA_UYGUN_TEMPLATE_YOK === 'UYGUN_TEMPLATE_YOK', 'skip code')
  assert(ATLAMA_TEMPLATE_GEREKLI.includes('TEMPLATE_GEREKLI'), 'template required')
  assert(ATLAMA_TEMPLATE_DEGISKEN_EKSIK === 'TEMPLATE_DEGISKEN_EKSIK', 'var missing code')

  const names = new Set(TEMPLATE_LIBRARY.map((e) => e.metaTemplateName))
  assert(names.size === 7, 'unique meta names')
  const keys = new Set(TEMPLATE_LIBRARY.map((e) => e.libraryKey))
  assert(keys.size === 7, 'unique library keys')

  console.log(
    JSON.stringify({
      ok: true,
      suite: 'whatsapp-template-library-quality',
      catalogSize: TEMPLATE_LIBRARY.length,
      notes: [
        'positional-components',
        'variable-order',
        'no-cloud-text-fallback-codes',
        'status-normalize',
        'no-real-meta-create'
      ]
    })
  )
}

main()
