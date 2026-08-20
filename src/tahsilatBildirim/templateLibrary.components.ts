/**
 * Merkezi Meta template BODY components üretimi (positional placeholders).
 * Create: {{1}}…{{n}} + example.body_text = [[ex1, ex2, …]]
 * Send: body.parameters[] ordered text (parameter_name yok).
 */
import type { TemplateVars } from './templates.js'
import {
  APP_VAR_TO_META_PARAM,
  getLibraryEntry,
  type TemplateLibraryEntry
} from './templateLibrary.catalog.js'

export type MetaBodyParameter = {
  type: 'text'
  text: string
}

export type MetaTemplateSendComponents = Array<{
  type: 'body'
  parameters: MetaBodyParameter[]
}>

export type PayloadValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string }

const POSITIONAL_RE = /\{\{(\d+)\}\}/g

/** BODY metnindeki {{n}} indekslerini sırayla çıkarır (tekrarlar dahil). */
export function extractPositionalIndices(text: string): number[] {
  return [...text.matchAll(POSITIONAL_RE)].map((m) => Number(m[1]))
}

/**
 * Ardışık {{1}}…{{n}} ve örnek sayısı kontrolü.
 * Meta create öncesi çağrılır; geçersizse API isteği atılmaz.
 */
export function validatePositionalBodyExamples(
  bodyText: string,
  examples: string[]
): PayloadValidationResult {
  const all = extractPositionalIndices(bodyText)
  if (all.length === 0) {
    if (examples.length > 0) {
      return {
        ok: false,
        code: 'VARIABLE_EXAMPLE_MISMATCH',
        message: 'Mesajda değişken yokken örnek değer gönderilemez.'
      }
    }
    return { ok: true }
  }

  const uniqueSorted = [...new Set(all)].sort((a, b) => a - b)
  for (let i = 0; i < uniqueSorted.length; i += 1) {
    if (uniqueSorted[i] !== i + 1) {
      return {
        ok: false,
        code: 'VARIABLE_INDEX_GAP',
        message: 'Değişkenler sıralı olmalı: {{1}}, {{2}}, …'
      }
    }
  }

  if (examples.length !== uniqueSorted.length) {
    return {
      ok: false,
      code: 'VARIABLE_EXAMPLE_MISMATCH',
      message: `Örnek değer sayısı (${examples.length}) değişken sayısıyla (${uniqueSorted.length}) uyuşmuyor.`
    }
  }

  for (let i = 0; i < examples.length; i += 1) {
    if (!String(examples[i] ?? '').trim()) {
      return {
        ok: false,
        code: 'VARIABLE_EXAMPLE_REQUIRED',
        message: `{{${i + 1}}} için örnek değer zorunludur.`
      }
    }
  }

  return { ok: true }
}

/** Meta create message_templates BODY component (+ nested body_text example). */
export function buildMetaCreateBodyComponent(entry: TemplateLibraryEntry): Record<string, unknown> {
  const examples = entry.variables.map((v) => String(entry.exampleValues[v] ?? '').trim())
  const validation = validatePositionalBodyExamples(entry.bodyMetaText, examples)
  if (!validation.ok) {
    throw new Error(`${validation.code}: ${validation.message}`)
  }

  const component: Record<string, unknown> = {
    type: 'BODY',
    text: entry.bodyMetaText
  }
  if (examples.length > 0) {
    component.example = {
      body_text: [examples]
    }
  }
  return component
}

export function buildMetaCreateTemplatePayload(entry: TemplateLibraryEntry): Record<string, unknown> {
  // parameter_format gönderilmez → Meta varsayılanı positional
  return {
    name: entry.metaTemplateName,
    language: entry.language,
    category: entry.category,
    components: [buildMetaCreateBodyComponent(entry)]
  }
}

/**
 * Create payload üret + doğrula. Geçersizse API çağrısı yapılmamalı.
 */
export function buildValidatedMetaCreateTemplatePayload(entry: TemplateLibraryEntry):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; code: string; message: string } {
  const examples = entry.variables.map((v) => String(entry.exampleValues[v] ?? '').trim())
  const validation = validatePositionalBodyExamples(entry.bodyMetaText, examples)
  if (!validation.ok) return validation
  try {
    return { ok: true, payload: buildMetaCreateTemplatePayload(entry) }
  } catch (e) {
    return {
      ok: false,
      code: 'TEMPLATE_PAYLOAD_INVALID',
      message: e instanceof Error ? e.message : 'Şablon payload geçersiz.'
    }
  }
}

/** Positional BODY + opsiyonel FOOTER (boş footer eklenmez). */
export function buildMetaCreateComponentsFromPositionalBody(opts: {
  bodyText: string
  examples: string[]
  footerText?: string | null
}):
  | { ok: true; components: Record<string, unknown>[] }
  | { ok: false; code: string; message: string } {
  const validation = validatePositionalBodyExamples(opts.bodyText, opts.examples)
  if (!validation.ok) return validation

  const body: Record<string, unknown> = {
    type: 'BODY',
    text: opts.bodyText
  }
  if (opts.examples.length > 0) {
    body.example = { body_text: [opts.examples] }
  }
  const components: Record<string, unknown>[] = [body]
  const footer = opts.footerText?.trim() ?? ''
  if (footer) {
    components.push({ type: 'FOOTER', text: footer.slice(0, 60) })
  }
  return { ok: true, components }
}

export function buildSendBodyComponentsFromVars(
  entry: TemplateLibraryEntry,
  vars: TemplateVars
):
  | { ok: true; components: MetaTemplateSendComponents }
  | { ok: false; missing: Array<keyof TemplateVars>; code: 'TEMPLATE_DEGISKEN_EKSIK' } {
  const missing: Array<keyof TemplateVars> = []
  const parameters: MetaBodyParameter[] = []

  for (const v of entry.variables) {
    const raw = vars[v]
    if (raw == null || String(raw).trim() === '') {
      missing.push(v)
      continue
    }
    parameters.push({
      type: 'text',
      text: String(raw).slice(0, 1024)
    })
  }

  if (missing.length > 0) {
    return { ok: false, missing, code: 'TEMPLATE_DEGISKEN_EKSIK' }
  }

  return {
    ok: true,
    components: [{ type: 'body', parameters }]
  }
}

export function buildSendBodyComponentsForLibraryKey(
  libraryKey: string,
  vars: TemplateVars
):
  | { ok: true; components: MetaTemplateSendComponents; entry: TemplateLibraryEntry }
  | { ok: false; missing?: Array<keyof TemplateVars>; code: string; message: string } {
  const entry = getLibraryEntry(libraryKey)
  if (!entry) {
    return { ok: false, code: 'LIBRARY_KEY_UNKNOWN', message: 'Bilinmeyen hazır şablon.' }
  }
  const built = buildSendBodyComponentsFromVars(entry, vars)
  if (!built.ok) {
    return {
      ok: false,
      missing: built.missing,
      code: built.code,
      message: `Şablon değişkenleri eksik: ${built.missing.join(', ')}`
    }
  }
  return { ok: true, components: built.components, entry }
}

export function componentsSnapshotForEntry(entry: TemplateLibraryEntry): Record<string, unknown> {
  return {
    parameterFormat: entry.parameterFormat,
    variables: entry.variables,
    metaParams: entry.variables.map((v) => APP_VAR_TO_META_PARAM[v]),
    bodyMetaText: entry.bodyMetaText,
    createComponents: [buildMetaCreateBodyComponent(entry)]
  }
}
