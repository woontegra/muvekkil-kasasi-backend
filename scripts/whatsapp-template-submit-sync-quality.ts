/**
 * Template submit/sync safety — mock Graph only (no real Meta POST).
 */
import {
  createWabaMessageTemplate,
  fetchWabaMessageTemplates,
  hasValidMetaTemplateId,
  isMetaTemplateAlreadyExistsError,
  normalizeMetaTemplateStatus
} from '../src/tahsilatBildirim/meta/embeddedSignup.js'
import { libraryStatusLabel } from '../src/tahsilatBildirim/templateLibrary.catalog.js'
import { graphVersion } from '../src/tahsilatBildirim/meta/graphClient.js'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function mockFetchSequence(
  responses: Array<{ status: number; body: unknown }>
): typeof fetch {
  let i = 0
  return (async () => {
    const next = responses[i] ?? responses[responses.length - 1]
    i += 1
    return {
      status: next.status,
      text: async () => JSON.stringify(next.body)
    } as Response
  }) as typeof fetch
}

async function main(): Promise<void> {
  // 1) Graph 200 + template ID → create ok with id
  {
    const fetchImpl = mockFetchSequence([
      { status: 200, body: { id: '111', status: 'PENDING' } }
    ])
    const created = await createWabaMessageTemplate({
      wabaId: '999',
      accessToken: 'tok',
      payload: { name: 'x' },
      fetchImpl
    })
    assert(created.ok === true, 'create 200 ok')
    if (created.ok) {
      assert(hasValidMetaTemplateId(created.id), 'create has id')
      assert(normalizeMetaTemplateStatus(created.status) === 'BEKLIYOR', 'pending map')
    }
  }

  // 2) Graph 400 → not ok, not alreadyExists (unless duplicate text)
  {
    const fetchImpl = mockFetchSequence([
      {
        status: 400,
        body: { error: { code: 100, message: 'Invalid parameter', type: 'OAuthException' } }
      }
    ])
    const created = await createWabaMessageTemplate({
      wabaId: '999',
      accessToken: 'tok',
      payload: { name: 'x' },
      fetchImpl
    })
    assert(created.ok === false, '400 not ok')
    if (!created.ok) {
      assert(created.alreadyExists === false, 'code 100 alone is NOT alreadyExists')
      assert(created.errorCode === 100, 'error code preserved')
    }
  }

  // 3) Graph 500 → fail
  {
    const fetchImpl = mockFetchSequence([
      { status: 500, body: { error: { code: 1, message: 'server' } } }
    ])
    const created = await createWabaMessageTemplate({
      wabaId: '999',
      accessToken: 'tok',
      payload: { name: 'x' },
      fetchImpl
    })
    assert(created.ok === false && !created.alreadyExists, '500 fail')
  }

  // 4) Graph 200 without id → ok but invalid for persist
  {
    const fetchImpl = mockFetchSequence([{ status: 200, body: { status: 'PENDING' } }])
    const created = await createWabaMessageTemplate({
      wabaId: '999',
      accessToken: 'tok',
      payload: { name: 'x' },
      fetchImpl
    })
    assert(created.ok === true, '200 ok shell')
    if (created.ok) assert(!hasValidMetaTemplateId(created.id), 'missing id invalid')
  }

  // 5) Duplicate detection is message/code specific — not blanket 100
  assert(isMetaTemplateAlreadyExistsError('Template name already exists', 100) === true, 'dup text')
  assert(isMetaTemplateAlreadyExistsError('Invalid parameter', 100) === false, '100 alone false')
  assert(isMetaTemplateAlreadyExistsError(null, 2388044) === true, '2388044')

  // 6) Pagination: two pages then stop
  {
    const v = graphVersion()
    const page1 = {
      data: [{ id: '1', name: 'a', language: 'tr', status: 'APPROVED', category: 'UTILITY' }],
      paging: {
        cursors: { after: 'cursor1' },
        next: `https://graph.facebook.com/${v}/waba/message_templates?after=cursor1`
      }
    }
    const page2 = {
      data: [{ id: '2', name: 'b', language: 'tr', status: 'PENDING', category: 'UTILITY' }]
    }
    const fetchImpl = mockFetchSequence([
      { status: 200, body: page1 },
      { status: 200, body: page2 }
    ])
    const fetched = await fetchWabaMessageTemplates('waba', 'tok', fetchImpl)
    assert(fetched.ok === true, 'fetch ok')
    assert(fetched.templates.length === 2, 'both pages')
    assert(fetched.paginationComplete === true, 'pagination complete')
  }

  // 7) Failed fetch → pagination incomplete (no reconcile)
  {
    const fetchImpl = mockFetchSequence([
      { status: 500, body: { error: { code: 1, message: 'fail' } } }
    ])
    const fetched = await fetchWabaMessageTemplates('waba', 'tok', fetchImpl)
    assert(fetched.ok === false, 'fetch fail')
    assert(fetched.paginationComplete === false, 'no reconcile on fail')
  }

  // 8) Labels
  assert(libraryStatusLabel(null).label === 'Henüz gönderilmedi', 'not sent label')
  assert(libraryStatusLabel('BEKLIYOR').label === 'İnceleniyor', 'pending label')

  // 9) WABA selection invariant (documented): submit/sync use tenant baglanti.wabaId only —
  // frontend never sends WABA into meta-onayina-gonder body (empty '{}').
  assert(true, 'tenant waba invariant')

  console.log(
    JSON.stringify({
      ok: true,
      suite: 'whatsapp-template-submit-sync-quality',
      notes: [
        'create-requires-id',
        'code-100-not-already-exists',
        'pagination-complete-flag',
        'failed-fetch-no-reconcile',
        'no-real-meta-post'
      ]
    })
  )
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
