import { z } from 'zod'
import { paraBirimiZodEnum } from './paraBirimi.js'

export const optionalParaBirimiSchema = z.enum(paraBirimiZodEnum).optional().nullable()

const tutarPositiveOptional = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === '') return undefined
    if (typeof v === 'string') {
      const s = v.trim()
      if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || (s.includes(',') && s.includes('.'))) {
        return Number(s.replace(/\./g, '').replace(',', '.'))
      }
      if (s.includes(',')) return Number(s.replace(',', '.'))
      return Number(s)
    }
    return v
  },
  z.number().finite().positive('Tutar pozitif olmalıdır.').optional()
)

const kurOptional = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === '') return undefined
    if (typeof v === 'string') return v.trim().replace(',', '.')
    return String(v)
  },
  z
    .string()
    .optional()
    .refine((v) => v === undefined || (Number.isFinite(Number(v)) && Number(v) > 0), {
      message: 'Kur pozitif olmalıdır.'
    })
)

/** Vekalet / icra ödeme gövdelerinde ortak çapraz kur + TCMB snapshot alanları. */
export const crossPaymentBodyFields = {
  odemeParaBirimi: optionalParaBirimiSchema,
  kasaTutari: tutarPositiveOptional,
  kurKaynagi: z.enum(['TCMB', 'MANUEL']).optional().nullable(),
  /** YYYY-MM-DD — TCMB’nin yayımladığı kur günü */
  tcmbKurTarihi: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  tcmbReferansKur: kurOptional,
  /** Kullanıcının uyguladığı kur (1 alacakPB = X ödemePB); yoksa tutarlardan hesaplanır */
  uygulananKur: kurOptional
} as const

export const dovizDonusumKurFields = {
  kurKaynagi: z.enum(['TCMB', 'MANUEL']).optional().nullable(),
  tcmbKurTarihi: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  tcmbReferansKur: kurOptional
} as const
