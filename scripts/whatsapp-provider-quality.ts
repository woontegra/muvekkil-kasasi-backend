/**
 * WhatsApp / bildirim kalite testleri — dış servis çağırmaz.
 * Migration uygulamaz.
 */
import { normalizeTurkiyePhone, maskPhone } from '../src/tahsilatBildirim/phone.js'
import { renderTemplate, DEFAULT_TEMPLATES } from '../src/tahsilatBildirim/templates.js'
import {
  ManualWhatsAppProvider,
  WhatsAppCloudApiProvider,
  resolveWhatsAppProvider,
  isWhatsAppCloudApiAllowed
} from '../src/tahsilatBildirim/providers/whatsappProvider.js'
import { env } from '../src/config/env.js'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

async function main(): Promise<void> {
  assert(normalizeTurkiyePhone('0532 111 22 33') === '905321112233', 'normalize 0532')
  assert(normalizeTurkiyePhone('+90 (532) 111-2233') === '905321112233', 'normalize +90')
  assert(normalizeTurkiyePhone('5321112233') === '905321112233', 'normalize 10 digit')
  assert(normalizeTurkiyePhone('123') === null, 'invalid phone')
  assert(normalizeTurkiyePhone('') === null, 'empty phone')

  const masked = maskPhone('905321112233')
  assert(masked.includes('••'), 'mask phone')
  assert(!masked.includes('53211122'), 'mask hides middle')

  const rendered = renderTemplate(DEFAULT_TEMPLATES.VADE_GUNU, {
    muvekkilAdi: 'Ali Veli',
    buroAdi: 'Demo Büro',
    dosyaBilgisi: 'Dosya 1',
    taksitTutari: '1000.00',
    odenenTutar: '0.00',
    kalanTutar: '1000.00',
    vadeTarihi: '01.08.2026',
    gecikmeGunu: '0'
  })
  assert(rendered.ok && rendered.text.includes('Ali Veli'), 'template fill')

  const missing = renderTemplate('Sayın {muvekkilAdi}', { buroAdi: 'X' })
  assert(!missing.ok && missing.missing.includes('muvekkilAdi'), 'missing template var')

  const manual = new ManualWhatsAppProvider()
  const link = await manual.send({
    tenantId: 't',
    toE164: '905321112233',
    text: 'Merhaba test',
    idempotencyKey: 'k1'
  })
  assert(link.ok && link.deepLinkUrl?.startsWith('https://wa.me/905321112233?text='), 'manual deep link')
  assert(link.deepLinkUrl!.includes(encodeURIComponent('Merhaba test')), 'url encoding')

  const cloud = new WhatsAppCloudApiProvider()
  const blocked = await cloud.send({
    tenantId: 't',
    toE164: '905321112233',
    text: 'x',
    idempotencyKey: 'k2'
  })
  assert(!blocked.ok, 'cloud blocked when not configured/flag')
  if (!env.WHATSAPP_CLOUD_API_ENABLED) {
    assert(blocked.code === 'FEATURE_DISABLED', 'feature flag closed')
  }

  const resolved = resolveWhatsAppProvider(null)
  assert(resolved.kind === 'MANUAL_WHATSAPP', 'default provider manual')
  assert(isWhatsAppCloudApiAllowed() === env.WHATSAPP_CLOUD_API_ENABLED, 'flag sync')

  console.log(JSON.stringify({ ok: true, providerDefault: resolved.kind, cloudFlag: env.WHATSAPP_CLOUD_API_ENABLED }))
}

main().catch((e) => {
  console.error('[test:whatsapp] failed', e instanceof Error ? e.message : e)
  process.exit(1)
})
