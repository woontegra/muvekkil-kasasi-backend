import { desktopRowId, pickNum } from './desktopImportMappers.js'

export function validateDesktopRows(
  muvekkilRows: Record<string, unknown>[],
  dosyaRows: Record<string, unknown>[],
  kasaRows: Record<string, unknown>[],
  vekaletRows: Record<string, unknown>[],
  taksitRows: Record<string, unknown>[]
): string[] {
  const errors: string[] = []
  const muIds = new Set<number>()
  for (const r of muvekkilRows) {
    const id = desktopRowId(r)
    if (id == null) errors.push('muvekkil tablosunda geçersiz veya eksik id satırı var.')
    else muIds.add(id)
  }
  for (const r of dosyaRows) {
    const id = desktopRowId(r)
    const mid = pickNum(r, 'muvekkil_id', 'muvekkilId')
    if (id == null) errors.push('dosya tablosunda geçersiz id.')
    if (mid == null || !muIds.has(mid)) errors.push(`dosya id=${id ?? '?'} için geçersiz muvekkil_id (${mid ?? '—'}).`)
  }
  const dosyaIds = new Set<number>()
  for (const r of dosyaRows) {
    const id = desktopRowId(r)
    if (id != null) dosyaIds.add(id)
  }
  for (const r of kasaRows) {
    const did = pickNum(r, 'dosya_id', 'dosyaId')
    if (did == null || !dosyaIds.has(did)) errors.push(`dosya_kasa_hareket için geçersiz dosya_id (${did ?? '—'}).`)
  }
  const vekIds = new Set<number>()
  for (const r of vekaletRows) {
    const id = desktopRowId(r)
    const did = pickNum(r, 'dosya_id', 'dosyaId')
    if (id == null) errors.push('anlasilan_vekalet_ucreti tablosunda geçersiz id.')
    if (did == null || !dosyaIds.has(did)) errors.push(`vekalet ücreti id=${id ?? '?'} için geçersiz dosya_id (${did ?? '—'}).`)
    if (id != null) vekIds.add(id)
  }
  for (const r of taksitRows) {
    const vid = pickNum(r, 'vekalet_ucreti_id', 'anlasilan_vekalet_ucreti_id', 'vekaletUcretiId')
    if (vid == null || !vekIds.has(vid)) errors.push(`vekalet taksiti için geçersiz vekalet ücreti referansı (${vid ?? '—'}).`)
  }
  return errors
}
