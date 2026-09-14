import { createHash } from 'node:crypto'
import { createReadStream, writeFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const transcript =
  'C:/Users/Woontegra/.cursor/projects/c-Users-Woontegra-Desktop-MUVEKKIL-KASASI-SAAS/agent-transcripts/80ab1f45-ce94-489a-9a54-b948d1e25ef9/80ab1f45-ce94-489a-9a54-b948d1e25ef9.jsonl'

const dbChecksum = 'e6312a07f24f702c4de2a1e0859996806ca28e2e276763518a51d93df4c289e3'

function sha(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

function applyStrReplace(content: string, oldStr: string, newStr: string): string {
  if (!content.includes(oldStr)) return content
  return content.replace(oldStr, newStr)
}

async function main() {
  const rl = createInterface({ input: createReadStream(transcript), crlfDelay: Infinity })
  let n = 0
  const candidates: Array<{ line: number; content: string; sha: string; note: string }> = []

  for await (const line of rl) {
    n++
    if (!line.includes('20260911153000_multi_currency')) continue
    try {
      const obj = JSON.parse(line) as {
        message?: { content?: Array<{ name?: string; input?: Record<string, string> }> }
      }
      const parts = obj?.message?.content
      if (!Array.isArray(parts)) continue
      for (const p of parts) {
        if (
          p?.name === 'Write' &&
          p.input?.path?.includes('20260911153000_multi_currency') &&
          typeof p.input.contents === 'string'
        ) {
          const c = p.input.contents
          candidates.push({
            line: n,
            content: c,
            sha: sha(c),
            note: `Write KurKaynagi=${c.includes('KurKaynagi')} IFN=${c.includes('IF NOT EXISTS')}`
          })
        }
        if (p?.name === 'StrReplace' && p.input?.path?.includes('20260911153000_multi_currency')) {
          const last = candidates[candidates.length - 1]
          if (last && p.input.old_string && p.input.new_string) {
            const c2 = applyStrReplace(last.content, p.input.old_string, p.input.new_string)
            candidates.push({
              line: n,
              content: c2,
              sha: sha(c2),
              note: `After StrReplace from line ${last.line} KurKaynagi=${c2.includes('KurKaynagi')} IFN=${c2.includes('IF NOT EXISTS')}`
            })
          }
        }
      }
    } catch {
      /* skip */
    }
  }

  for (const c of candidates) {
    console.log(JSON.stringify({ line: c.line, sha: c.sha, matchDb: c.sha === dbChecksum, note: c.note }))
    if (c.sha === dbChecksum) {
      writeFileSync('prisma/migrations/_recovered_original.sql', c.content)
      console.log('WROTE_MATCH prisma/migrations/_recovered_original.sql')
    }
  }

  // Also try CRLF vs LF variants of best non-TCMB candidate
  const withoutTcmb = candidates.filter((c) => !c.content.includes('KurKaynagi'))
  for (const c of withoutTcmb) {
    for (const variant of [
      c.content,
      c.content.replace(/\r\n/g, '\n'),
      c.content.replace(/\n/g, '\r\n'),
      c.content.endsWith('\n') ? c.content : c.content + '\n',
      c.content.replace(/\n+$/, '') + '\n',
      c.content.replace(/\n+$/, '')
    ]) {
      const h = sha(variant)
      if (h === dbChecksum) {
        writeFileSync('prisma/migrations/_recovered_original.sql', variant)
        console.log('WROTE_MATCH_VARIANT', c.note, 'bytes', Buffer.byteLength(variant, 'utf8'))
      }
    }
  }

  console.log('candidates', candidates.length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
