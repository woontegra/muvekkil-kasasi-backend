import { OfisKasaIslemTipi, OfisKasaOnayDurumu } from '@prisma/client'
import { z } from 'zod'
import { listOfisKasaHareketleriQuerySchema } from '../ofisKasa/ofisKasa.schemas.js'

export const ofisKasaReportQuerySchema = listOfisKasaHareketleriQuerySchema
  .omit({ page: true, limit: true })
  .extend({
    startDate: z.preprocess(
      (v) => (v === '' || v === undefined || v === null ? undefined : v),
      z.coerce.date().optional()
    ),
    endDate: z.preprocess(
      (v) => (v === '' || v === undefined || v === null ? undefined : v),
      z.coerce.date().optional()
    )
  })

export type OfisKasaReportQuery = z.infer<typeof ofisKasaReportQuerySchema>

export const icraTahsilatReportQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  alacakTuru: z.enum(['KARSI_TARAF_VEKALET', 'ICRA_VEKALET']).optional(),
  durum: z.enum(['ACIK', 'KISMI_ODENDI', 'ODENDI', 'GECIKTI', 'IPTAL']).optional(),
  tahsilatiYapanPersonelId: z.string().uuid().optional(),
  startDate: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.date().optional()
  ),
  endDate: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.date().optional()
  )
})

export type IcraTahsilatReportQuery = z.infer<typeof icraTahsilatReportQuerySchema>

export function normalizeReportEndDate(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

export function normalizeReportStartDate(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export const OFIS_KASA_REPORT_MAX_ROWS = 5000

export const ONAY_LABEL: Record<OfisKasaOnayDurumu, string> = {
  ONAYSIZ: 'Onaysız',
  ONAYLI: 'Onaylı',
  REDDEDILDI: 'Reddedildi'
}

export const ISLEM_TIPI_LABEL: Record<OfisKasaIslemTipi, string> = {
  GELIR: 'Gelir',
  GIDER: 'Gider',
  DUZELTME: 'Düzeltme'
}
