import { DosyaDurumu, DosyaTuru } from '@prisma/client'
import { z } from 'zod'

const emptyToNull = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).trim()
  return s.length === 0 ? null : s
}

const optionalNullableString = z.preprocess(emptyToNull, z.string().max(2000).nullable())

const dosyaWriteFields = z.object({
  konuBasligi: z.string().trim().min(1, 'Konu başlığı zorunludur.').max(500),
  mahkeme: optionalNullableString,
  icraDairesi: optionalNullableString,
  dosyaNo: optionalNullableString,
  dosyaTuru: z.nativeEnum(DosyaTuru),
  durum: z.nativeEnum(DosyaDurumu).default(DosyaDurumu.AKTIF),
  aciklama: z.preprocess(emptyToNull, z.string().max(8000).nullable())
})

export const createDosyaBodySchema = dosyaWriteFields
export type CreateDosyaBody = z.infer<typeof createDosyaBodySchema>

export const updateDosyaBodySchema = dosyaWriteFields
export type UpdateDosyaBody = z.infer<typeof updateDosyaBodySchema>

export const listDosyaForMuvekkilQuerySchema = z.object({
  q: z.string().trim().optional().default(''),
  durum: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.nativeEnum(DosyaDurumu).optional()
  ),
  dosyaTuru: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.nativeEnum(DosyaTuru).optional()
  ),
  page: z.preprocess((v) => (v === undefined || v === '' ? 1 : Number(v)), z.number().int().min(1)),
  limit: z.preprocess((v) => (v === undefined || v === '' ? 50 : Number(v)), z.number().int().min(1).max(100))
})

export type ListDosyaForMuvekkilQuery = z.infer<typeof listDosyaForMuvekkilQuerySchema>
