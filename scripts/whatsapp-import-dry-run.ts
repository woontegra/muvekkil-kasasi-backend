/**
 * Read-only Woontegra mevcut-WABA import doğrulaması.
 * - Mesaj göndermez, DB yazmaz, webhook değiştirmez, deploy etmez.
 * - Zorunlu: WHATSAPP_WOONTEGRA_SYSTEM_USER_TOKEN
 * - WHATSAPP_CLOUD_TEST_PHONE gerekmez (presence yalnızca raporlanır)
 */
import { env } from '../src/config/env.js'
import { verifyExistingWabaPhoneAssets } from '../src/tahsilatBildirim/meta/verifyExistingAssets.js'

const WABA_ID = '420529479291363'
const PHONE_NUMBER_ID = '525890038336054'

function presence(v: string | undefined): 'SET' | 'MISSING' {
  return v?.trim() ? 'SET' : 'MISSING'
}

async function main() {
  const systemToken = env.WHATSAPP_WOONTEGRA_SYSTEM_USER_TOKEN?.trim() || ''
  const report = {
    mode: 'import-dry-run-read-only',
    wabaId: WABA_ID,
    phoneNumberId: PHONE_NUMBER_ID,
    env: {
      WHATSAPP_WOONTEGRA_SYSTEM_USER_TOKEN: presence(systemToken),
      WHATSAPP_CLOUD_TEST_PHONE: presence(env.WHATSAPP_CLOUD_TEST_PHONE),
      WHATSAPP_CLOUD_API_ENABLED: env.WHATSAPP_CLOUD_API_ENABLED
    },
    cloudTestPhoneRequiredForImport: false,
    webhookOverrideWouldRun: false,
    realMessageSent: false,
    dbWrite: false
  }

  if (!systemToken) {
    console.log(
      JSON.stringify(
        {
          ...report,
          ok: false,
          code: 'CONFIG_MISSING',
          message:
            'Import dry-run için yalnızca WHATSAPP_WOONTEGRA_SYSTEM_USER_TOKEN gerekli. WHATSAPP_CLOUD_TEST_PHONE eksikliği import’u engellemez.'
        },
        null,
        2
      )
    )
    process.exit(2)
  }

  const verified = await verifyExistingWabaPhoneAssets({
    wabaId: WABA_ID,
    phoneNumberId: PHONE_NUMBER_ID,
    accessToken: systemToken
  })

  if (!verified.ok) {
    console.log(
      JSON.stringify(
        {
          ...report,
          ok: false,
          code: verified.code,
          message: verified.message
        },
        null,
        2
      )
    )
    process.exit(1)
  }

  console.log(
    JSON.stringify(
      {
        ...report,
        ok: true,
        verified: true,
        displayPhoneNumber: verified.data.displayPhoneNumber,
        verifiedName: verified.data.verifiedName,
        phoneStatus: verified.data.phoneStatus,
        wabaName: verified.data.wabaName,
        note: 'Read-only Meta asset doğrulaması tamam. Sender = imported connection phone; recipients in production = müvekkil DB phones.'
      },
      null,
      2
    )
  )
}

main().catch((e) => {
  console.error('[whatsapp-import-dry-run] failed', e instanceof Error ? e.message : e)
  process.exit(1)
})
