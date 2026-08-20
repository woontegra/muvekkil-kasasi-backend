/**
 * Meta BODY variable-edge rules — mock only (no real Graph POST).
 */
import { TEMPLATE_LIBRARY, getLibraryEntry } from '../src/tahsilatBildirim/templateLibrary.catalog.js'
import {
  BODY_VARIABLE_EDGE_MESSAGE,
  buildValidatedMetaCreateTemplatePayload,
  validateBodyVariableEdges,
  validateMetaCreateBody
} from '../src/tahsilatBildirim/templateLibrary.components.js'
import { createWabaMessageTemplate } from '../src/tahsilatBildirim/meta/embeddedSignup.js'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

let graphCalls = 0
const countingFetch: typeof fetch = (async () => {
  graphCalls += 1
  return {
    status: 200,
    text: async () => JSON.stringify({ id: 'should-not-be-called' })
  } as Response
}) as typeof fetch

async function main(): Promise<void> {
  // 1) Starts with {{1}}
  {
    const r = validateBodyVariableEdges('{{1}} merhaba')
    assert(r.ok === false && r.message === BODY_VARIABLE_EDGE_MESSAGE, 'starts with var')
  }

  // 2) Ends with {{1}}
  {
    const r = validateBodyVariableEdges('Metin {{1}}')
    assert(r.ok === false, 'ends with var')
  }

  // 3) Only punctuation after last var
  {
    const r = validateBodyVariableEdges('Merhaba {{1}}.')
    assert(r.ok === false, 'punct only after')
    const r2 = validateBodyVariableEdges('Merhaba {{1}} !')
    assert(r2.ok === false, 'punct+space only after')
  }

  // 4) Meaningful fixed text on both sides
  {
    const r = validateBodyVariableEdges(
      'Sayın {{1}}, bilginize. Bu mesaj {{2}} tarafından gönderilmiştir.'
    )
    assert(r.ok === true, 'meaningful edges ok')
  }

  // 5) All 7 catalog bodies pass
  for (const entry of TEMPLATE_LIBRARY) {
    const examples = entry.variables.map((v) => String(entry.exampleValues[v] ?? '').trim())
    const r = validateMetaCreateBody(entry.bodyMetaText, examples)
    assert(r.ok === true, `catalog ${entry.libraryKey} passes edge+examples`)
    assert(!/^\{\{\d+\}\}/.test(entry.bodyMetaText.trim()), `${entry.libraryKey} no start var`)
    assert(!/\{\{\d+\}\}$/.test(entry.bodyMetaText.trim()), `${entry.libraryKey} no end var`)
    const validated = buildValidatedMetaCreateTemplatePayload(entry)
    assert(validated.ok === true, `validated payload ${entry.libraryKey}`)
  }

  // 6) Custom-like: draft-style invalid edge fails Meta validation helper
  {
    const edge = validateBodyVariableEdges('Merhaba {{1}}')
    assert(edge.ok === false, 'custom invalid blocked for meta')
  }

  // 7) Failed validation → no Graph call (library validated path)
  {
    graphCalls = 0
    const badEntry = {
      ...getLibraryEntry('TAHSILAT_VADE_ONCESI')!,
      bodyMetaText: 'Sayın {{1}}, bilgi. {{2}}'
    }
    const validated = buildValidatedMetaCreateTemplatePayload(badEntry)
    assert(validated.ok === false && validated.code === 'BODY_VARIABLE_EDGE', 'library edge reject')
    if (validated.ok) {
      await createWabaMessageTemplate({
        wabaId: 'w',
        accessToken: 't',
        payload: validated.payload,
        fetchImpl: countingFetch
      })
    }
    assert(graphCalls === 0, 'graph not called after edge fail')
  }

  // Specific requested text for vade oncesi
  {
    const e = getLibraryEntry('TAHSILAT_VADE_ONCESI')!
    assert(
      e.bodyMetaText.includes('Bu mesaj {{5}} tarafından gönderilmiştir.'),
      'vade oncesi closing phrase'
    )
  }

  console.log(
    JSON.stringify({
      ok: true,
      suite: 'whatsapp-template-body-edge-quality',
      catalogChecked: TEMPLATE_LIBRARY.length,
      notes: ['no-start-var', 'no-end-var', 'meaningful-fixed-text', 'no-real-meta-post']
    })
  )
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
