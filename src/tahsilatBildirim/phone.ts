/** Türkiye cep telefonunu WhatsApp formatına dönüştürür (90XXXXXXXXXX). Frontend ile aynı mantık. */
export function normalizeTurkiyePhone(telefon: string): string | null {
  const digits = telefon.replace(/\D/g, '')
  if (digits.length === 10 && digits.startsWith('5')) return `90${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `9${digits}`
  if (digits.length === 12 && digits.startsWith('90')) return digits
  return null
}

/** Görüntü için maske: 05•• ••• ••32 (tam numara loglanmaz). */
export function maskPhone(telefon: string): string {
  const digits = telefon.replace(/\D/g, '')
  let local = digits
  if (local.startsWith('90') && local.length >= 12) {
    local = `0${local.slice(2, 12)}`
  } else if (local.length === 10 && local.startsWith('5')) {
    local = `0${local}`
  } else if (local.length === 11 && local.startsWith('0')) {
    // ok
  } else if (local.length >= 4) {
    return `••• ••• ••${local.slice(-2)}`
  } else {
    return '••• ••• ••••'
  }
  return `${local.slice(0, 2)}•• ••• ••${local.slice(-2)}`
}
