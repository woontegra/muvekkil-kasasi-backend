/**
 * Merkezi Meta template BODY components üretimi (named parameter_format).
 * Kaynak: Meta Template API — parameter_format named + body_text_named_params;
 * gönderimde body.parameters[].parameter_name.
 */
import type { TemplateVars } from './templates.js'
import {
  APP_VAR_TO_META_PARAM,
  getLibraryEntry,
  type TemplateLibraryEntry
} from './templateLibrary.catalog.js'

export type MetaNamedBodyParameter = {
  type: 'text'
  parameter_name: string
  text: string
}

export type MetaTemplateSendComponents = Array<{
  type: 'body'
  parameters: MetaNamedBodyParameter[]
}>

/** Meta create message_templates BODY component (+ example). */
export function buildMetaCreateBodyComponent(entry: TemplateLibraryEntry): Record<string, unknown> {
  return {
    type: 'BODY',
    text: entry.bodyMetaText,
    example: {
      body_text_named_params: entry.variables.map((v) => ({
        param_name: APP_VAR_TO_META_PARAM[v],
        example: String(entry.exampleValues[v] ?? 'örnek')
      }))
    }
  }
}

export function buildMetaCreateTemplatePayload(entry: TemplateLibraryEntry): Record<string, unknown> {
  return {
    name: entry.metaTemplateName,
    language: entry.language,
    category: entry.category,
    parameter_format: 'named',
    components: [buildMetaCreateBodyComponent(entry)]
  }
}

export function buildSendBodyComponentsFromVars(
  entry: TemplateLibraryEntry,
  vars: TemplateVars
):
  | { ok: true; components: MetaTemplateSendComponents }
  | { ok: false; missing: Array<keyof TemplateVars>; code: 'TEMPLATE_DEGISKEN_EKSIK' } {
  const missing: Array<keyof TemplateVars> = []
  const parameters: MetaNamedBodyParameter[] = []

  for (const v of entry.variables) {
    const raw = vars[v]
    if (raw == null || String(raw).trim() === '') {
      missing.push(v)
      continue
    }
    parameters.push({
      type: 'text',
      parameter_name: APP_VAR_TO_META_PARAM[v],
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
