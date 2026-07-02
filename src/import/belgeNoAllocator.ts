/** Dosya kasası (DK) veya ofis kasası (OK) içe aktarım belge numarası üretici. */
export type ImportBelgeKind = 'DK' | 'OK'

export type BelgeNoAllocator = {
  allocate: (wanted: string | null | undefined, kind: ImportBelgeKind, sourceRowId: number) => string
  summaryWarnings: () => string[]
}

export function createBelgeNoAllocator(reserved: Set<string>, batchShort: string): BelgeNoAllocator {
  let emptyFilled = 0
  let conflictResolved = 0
  const conflictSamples: string[] = []

  function uniqueNo(base: string): string {
    let candidate = base
    let n = 0
    while (reserved.has(candidate)) {
      n += 1
      candidate = `${base}-${n}`
    }
    reserved.add(candidate)
    return candidate
  }

  function allocate(
    wanted: string | null | undefined,
    kind: ImportBelgeKind,
    sourceRowId: number
  ): string {
    const raw = (wanted ?? '').trim()
    if (!raw) {
      emptyFilled += 1
      return uniqueNo(`IMP-${batchShort}-${kind}-${sourceRowId}`)
    }
    if (!reserved.has(raw)) {
      reserved.add(raw)
      return raw
    }
    conflictResolved += 1
    if (conflictSamples.length < 5 && !conflictSamples.includes(raw)) {
      conflictSamples.push(raw)
    }
    const safe = raw.replace(/[^\w.-]/g, '_').slice(0, 40)
    return uniqueNo(`IMP-${batchShort}-${kind}-${sourceRowId}-${safe}`)
  }

  function summaryWarnings(): string[] {
    const out: string[] = []
    if (emptyFilled > 0) {
      out.push(
        `Belge numarası boş olan ${emptyFilled} kayıt güvenli şekilde yeni numarayla aktarıldı.`
      )
    }
    if (conflictResolved > 0) {
      const sample =
        conflictSamples.length > 0 ? ` Örnek çakışan numaralar: ${conflictSamples.join(', ')}.` : ''
      out.push(
        `${conflictResolved} kayıtta belge numarası mevcut SaaS kayıtlarıyla çakıştığı için yeniden üretildi.${sample}`
      )
    }
    return out
  }

  return { allocate, summaryWarnings }
}
