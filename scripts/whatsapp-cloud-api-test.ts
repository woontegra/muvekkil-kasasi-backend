/**
 * Kontrollü WhatsApp Cloud API bağlantı testi.
 *
 * - Tahsilat scheduler/worker çalıştırmaz
 * - Müşteri listesi / job üretmez
 * - DB güncellemez
 * - Alıcı yalnızca WHATSAPP_CLOUD_TEST_PHONE
 *
 * Kullanım:
 *   WHATSAPP_CLOUD_TEST_PHONE=905xxxxxxxxx npm run whatsapp:cloud-test
 */
import { env } from '../src/config/env.js'
import { maskPhone, normalizeTurkiyePhone } from '../src/tahsilatBildirim/phone.js'
import {
  isWhatsAppCloudApiAllowed,
  isWhatsAppCloudApiConfigured
} from '../src/tahsilatBildirim/providers/whatsappProvider.js'
import { platformSmokeSend } from '../src/tahsilatBildirim/connection.service.js'

const FREE_TEXT =
  'Woontegra Müvekkil Kasa WhatsApp bağlantı testi başarıyla çalışıyor.'

function presence(v: string | undefined | null): 'mevcut' | 'eksik' {
  return v != null && String(v).trim() !== '' ? 'mevcut' : 'eksik'
}

function reportEnv(): Record<string, 'mevcut' | 'eksik'> {
  // process.env üzerinden varlık — değer loglanmaz
  return {
    WHATSAPP_CLOUD_API_ENABLED: presence(process.env.WHATSAPP_CLOUD_API_ENABLED),
    WHATSAPP_WABA_ID: presence(process.env.WHATSAPP_WABA_ID),
    WHATSAPP_PHONE_NUMBER_ID: presence(process.env.WHATSAPP_PHONE_NUMBER_ID),
    WHATSAPP_ACCESS_TOKEN: presence(process.env.WHATSAPP_ACCESS_TOKEN),
    WHATSAPP_CLOUD_TEST_PHONE: presence(process.env.WHATSAPP_CLOUD_TEST_PHONE),
    WHATSAPP_WEBHOOK_ENABLED: presence(process.env.WHATSAPP_WEBHOOK_ENABLED),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: presence(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    WHATSAPP_APP_SECRET: presence(process.env.WHATSAPP_APP_SECRET)
  }
}

async function main(): Promise<void> {
  const envStatus = reportEnv()
  console.log('[whatsapp:cloud-test] env doğrulama (değer yok, yalnızca mevcut/eksik):')
  console.log(JSON.stringify(envStatus, null, 2))

  if (!env.WHATSAPP_CLOUD_API_ENABLED) {
    console.error('[whatsapp:cloud-test] WHATSAPP_CLOUD_API_ENABLED kapalı — gönderim yapılmadı.')
    process.exit(1)
  }

  if (!isWhatsAppCloudApiConfigured()) {
    console.error(
      '[whatsapp:cloud-test] WHATSAPP_PHONE_NUMBER_ID veya WHATSAPP_ACCESS_TOKEN eksik — gönderim yapılmadı.'
    )
    process.exit(1)
  }

  const rawPhone = env.WHATSAPP_CLOUD_TEST_PHONE
  if (!rawPhone) {
    console.error(
      '[whatsapp:cloud-test] WHATSAPP_CLOUD_TEST_PHONE tanımlı değil — mesaj gönderilmedi (kontrollü hata).'
    )
    process.exit(1)
  }

  const toE164 = normalizeTurkiyePhone(rawPhone) ?? (rawPhone.replace(/\D/g, '').length >= 10
    ? rawPhone.replace(/\D/g, '')
    : null)
  if (!toE164) {
    console.error('[whatsapp:cloud-test] WHATSAPP_CLOUD_TEST_PHONE geçersiz — mesaj gönderilmedi.')
    process.exit(1)
  }

  const masked = maskPhone(toE164)
  const templateName = env.WHATSAPP_CLOUD_TEST_TEMPLATE_NAME?.trim() || 'hello_world'
  const templateLang = env.WHATSAPP_CLOUD_TEST_TEMPLATE_LANG?.trim() || 'en_US'

  // Platform smoke: global env credentials (tenant send yolu değil).
  if (!isWhatsAppCloudApiAllowed()) {
    console.error('[whatsapp:cloud-test] WHATSAPP_CLOUD_API_ENABLED kapalı.')
    process.exit(1)
  }

  console.log(
    JSON.stringify({
      step: 'send',
      provider: 'WHATSAPP_CLOUD_API',
      mode: 'platform_smoke',
      toMasked: masked,
      templateName,
      templateLanguage: templateLang,
      freeTextNotForced: true,
      freeTextReference: FREE_TEXT
    })
  )

  const result = await platformSmokeSend({
    toE164,
    text: FREE_TEXT,
    templateName,
    templateLanguage: templateLang
  })

  if (result.ok) {
    console.log(
      JSON.stringify({
        success: true,
        provider: 'WHATSAPP_CLOUD_API',
        whatsappMessageId: result.providerMessageId ?? null,
        toMasked: masked,
        usedTemplate: true,
        templateName,
        note: 'Platform smoke (global env). Tenant gönderimleri WhatsAppBaglanti kullanır.'
      })
    )
    process.exit(0)
  }

  console.error(
    JSON.stringify({
      success: false,
      code: result.code,
      message: result.message,
      toMasked: masked,
      templateName
    })
  )
  process.exit(1)
}

main().catch((e) => {
  console.error(
    '[whatsapp:cloud-test] beklenmeyen hata',
    e instanceof Error ? e.message : 'unknown'
  )
  process.exit(1)
})
