/**
 * Meta create payload schema — mock only (no real Graph POST).
 */
import { getLibraryEntry } from '../src/tahsilatBildirim/templateLibrary.catalog.js'
import {
  buildMetaCreateComponentsFromPositionalBody,
  buildMetaCreateTemplatePayload,
  buildValidatedMetaCreateTemplatePayload,
  validatePositionalBodyExamples
} from '../src/tahsilatBildirim/templateLibrary.components.js'
import {
  createWabaMessageTemplate,
  hasValidMetaTemplateId
} from '../src/tahsilatBildirim/meta/embeddedSignup.js'
import {
  formatSafeMetaCreateErrorMessage,
  sanitizeGraphError
} from '../src/tahsilatBildirim/meta/graphClient.js'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      status,
      text: async () => JSON.stringify(body)
    }) as Response) as typeof fetch
}

async function main(): Promise<void> {
  const entry = getLibraryEntry('TAHSILAT_VADE_ONCESI')!
  const payload = buildMetaCreateTemplatePayload(entry)

  // Old bug: named + body_text_named_params — must be gone
  assert(!('parameter_format' in payload), 'no parameter_format (positional default)')
  assert(payload.name === 'mk_tahsilat_vade_oncesi_v1', 'name')
  assert(payload.language === 'tr', 'language')
  assert(payload.category === 'UTILITY', 'category')

  const comps = payload.components as Array<{
    type: string
    text: string
    example?: { body_text?: string[][]; body_text_named_params?: unknown }
  }>
  assert(comps.length === 1, 'single BODY')
  assert(comps[0]!.type === 'BODY', 'BODY type')
  assert(comps[0]!.text.includes('{{1}}'), 'pos 1')
  assert(comps[0]!.text.includes('{{5}}'), 'pos 5')
  assert(comps[0]!.text.includes('tarafından gönderilmiştir'), 'fixed closing')
  assert(!comps[0]!.text.includes('muvekkil_adi'), 'no named placeholders')
  assert(!comps[0]!.example?.body_text_named_params, 'no named examples')
  const bodyText = comps[0]!.example!.body_text!
  assert(Array.isArray(bodyText) && Array.isArray(bodyText[0]), 'nested body_text')
  assert(bodyText[0]!.length === 5, 'five examples')
  assert(bodyText[0]![0] === 'Ahmet Yılmaz', 'first example')

  // Single variable → [[value]]
  {
    const one = buildMetaCreateComponentsFromPositionalBody({
      bodyText: 'Merhaba {{1}} dostum.',
      examples: ['Ayşe']
    })
    assert(one.ok === true, 'one var ok')
    if (one.ok) {
      const ex = (one.components[0] as { example: { body_text: string[][] } }).example.body_text
      assert(JSON.stringify(ex) === JSON.stringify([['Ayşe']]), 'single nested')
    }
  }

  // Multi variables preserve order in one inner array
  {
    const multi = buildMetaCreateComponentsFromPositionalBody({
      bodyText: 'A {{1}} B {{2}} C {{3}} tamam.',
      examples: ['1', '2', '3']
    })
    assert(multi.ok === true, 'multi ok')
    if (multi.ok) {
      const ex = (multi.components[0] as { example: { body_text: string[][] } }).example.body_text
      assert(JSON.stringify(ex) === JSON.stringify([['1', '2', '3']]), 'ordered nested')
    }
  }

  // Missing example → no API (validation fail)
  {
    const bad = validatePositionalBodyExamples('Hi {{1}} {{2}}', ['only-one'])
    assert(bad.ok === false && bad.code === 'VARIABLE_EXAMPLE_MISMATCH', 'missing example')
    const validated = buildValidatedMetaCreateTemplatePayload({
      ...entry,
      exampleValues: { muvekkilAdi: 'x' } // incomplete
    })
    assert(validated.ok === false, 'validated blocks incomplete examples')
  }

  // Non-consecutive → no API
  {
    const gap = validatePositionalBodyExamples('Hi {{1}} {{3}}', ['a', 'b'])
    assert(gap.ok === false && gap.code === 'VARIABLE_INDEX_GAP', 'gap blocked')
  }

  // Empty footer omitted
  {
    const withEmpty = buildMetaCreateComponentsFromPositionalBody({
      bodyText: 'Hi {{1}} done.',
      examples: ['A'],
      footerText: '   '
    })
    assert(withEmpty.ok === true, 'empty footer ok')
    if (withEmpty.ok) {
      assert(withEmpty.components.length === 1, 'footer omitted')
      assert(!withEmpty.components.some((c) => c.type === 'FOOTER'), 'no FOOTER')
    }
    const withFooter = buildMetaCreateComponentsFromPositionalBody({
      bodyText: 'Hi {{1}} done.',
      examples: ['A'],
      footerText: 'Büro'
    })
    assert(withFooter.ok === true && withFooter.components.length === 2, 'footer kept')
  }

  // Meta code 100 detail preserved
  {
    const sanitized = sanitizeGraphError(
      {
        error: {
          message: 'Invalid parameter',
          type: 'OAuthException',
          code: 100,
          error_subcode: 33,
          error_user_title: 'Invalid',
          error_user_msg: 'The parameter components is required.',
          error_data: { details: 'body_text must be a nested array' },
          fbtrace_id: 'AbCdEf'
        }
      },
      400
    )
    assert(sanitized.errorDetails.error_user_msg?.includes('components'), 'user msg')
    assert(sanitized.errorDetails.details?.includes('body_text'), 'details')
    assert(sanitized.errorDetails.error_subcode === 33, 'subcode')
    const msg = formatSafeMetaCreateErrorMessage(sanitized.errorDetails, 'Test Hesap')
    assert(msg.includes('Meta kodu: 100'), 'code in msg')
    assert(msg.includes('alt kod: 33'), 'subcode in msg')
    assert(msg.includes('Destek kodu: AbCdEf'), 'fbtrace')
    assert(msg.includes('body_text') || msg.includes('components'), 'explanation')
  }

  // Meta 2xx without id → invalid
  {
    const created = await createWabaMessageTemplate({
      wabaId: 'w',
      accessToken: 't',
      payload: { name: 'x' },
      fetchImpl: mockFetch(200, { status: 'PENDING' })
    })
    assert(created.ok === true, 'http ok')
    if (created.ok) assert(!hasValidMetaTemplateId(created.id), 'id missing fails persist rule')
  }

  // Graph 400 with details → failure object carries details (Henüz gönderilmedi path)
  {
    const created = await createWabaMessageTemplate({
      wabaId: 'w',
      accessToken: 't',
      payload: { name: 'x' },
      fetchImpl: mockFetch(400, {
        error: {
          code: 100,
          message: 'Invalid parameter',
          error_user_msg: 'Components are invalid',
          error_data: { details: 'Invalid example format' }
        }
      })
    })
    assert(created.ok === false, '400 fail')
    if (!created.ok) {
      assert(created.errorCode === 100, 'code 100')
      assert(created.errorDetails?.details === 'Invalid example format', 'details kept')
      assert(created.alreadyExists === false, 'not alreadyExists')
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      suite: 'whatsapp-template-payload-quality',
      samplePayload: payload,
      notes: [
        'positional-body_text-nested',
        'no-named-params',
        'validate-before-api',
        'safe-meta-error-details',
        'no-real-meta-post'
      ]
    })
  )
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
