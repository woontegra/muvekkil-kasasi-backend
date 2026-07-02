import { PrimHesaplamaTipi, PrimKuralKapsam } from '@prisma/client'
import { z } from 'zod'

const tutarDecimal = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v),
  z.number().finite().min(0)
)

const oranDecimal = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v),
  z.number().finite().min(0).max(100)
)

export const primKademeBodySchema = z.object({
  minTutar: tutarDecimal,
  maxTutar: tutarDecimal.nullable().optional(),
  oranYuzde: oranDecimal,
  siraNo: z.number().int().min(0).optional()
})

export const createPrimKuralBodySchema = z
  .object({
    ad: z.string().trim().min(2).max(120),
    aktifMi: z.boolean().optional().default(true),
    kapsam: z.nativeEnum(PrimKuralKapsam),
    userId: z.string().uuid().optional().nullable(),
    primPersonelId: z.string().uuid().optional().nullable(),
    hesaplamaTipi: z.nativeEnum(PrimHesaplamaTipi),
    dosyaTahsilatMi: z.boolean().optional().default(true),
    vekaletTahsilatMi: z.boolean().optional().default(true),
    ofisKasaGelirMi: z.boolean().optional().default(true),
    icraTahsilatMi: z.boolean().optional().default(false),
    kademeler: z.array(primKademeBodySchema).min(1)
  })
  .superRefine((d, ctx) => {
    if (d.kapsam === PrimKuralKapsam.USER_SPECIFIC && !d.primPersonelId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Personel özel kural için personel seçilmelidir.', path: ['primPersonelId'] })
    }
    if (d.kapsam === PrimKuralKapsam.TENANT_DEFAULT && (d.userId || d.primPersonelId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Büro varsayılan kuralında personel seçilemez.', path: ['primPersonelId'] })
    }
  })

export const updatePrimKuralBodySchema = z.object({
  ad: z.string().trim().min(2).max(120).optional(),
  aktifMi: z.boolean().optional(),
  kapsam: z.nativeEnum(PrimKuralKapsam).optional(),
  userId: z.string().uuid().optional().nullable(),
  primPersonelId: z.string().uuid().optional().nullable(),
  hesaplamaTipi: z.nativeEnum(PrimHesaplamaTipi).optional(),
  dosyaTahsilatMi: z.boolean().optional(),
  vekaletTahsilatMi: z.boolean().optional(),
  ofisKasaGelirMi: z.boolean().optional(),
  icraTahsilatMi: z.boolean().optional(),
  kademeler: z.array(primKademeBodySchema).min(1).optional()
})

export const primRaporQuerySchema = z.object({
  yil: z.coerce.number().int().min(2000).max(2100),
  ay: z.coerce.number().int().min(1).max(12),
  userId: z.string().uuid().optional(),
  primPersonelId: z.string().uuid().optional(),
  tahsilatTuru: z.enum(['DOSYA_AVANS', 'VEKALET', 'OFIS_GELIR', 'ICRA', 'TUMU']).optional().default('TUMU')
})

export const personelPanelOzetQuerySchema = z.object({
  yil: z.coerce.number().int().min(2000).max(2100),
  ay: z.coerce.number().int().min(1).max(12)
})

export const personelPanelDetayQuerySchema = personelPanelOzetQuerySchema.extend({
  tahsilatTuru: z.enum(['DOSYA_AVANS', 'VEKALET', 'OFIS_GELIR', 'ICRA', 'TUMU']).optional().default('TUMU'),
  onayDurumu: z.enum(['TUMU', 'ONAYSIZ', 'ONAYLI', 'REDDEDILDI']).optional().default('TUMU'),
  /** true ise prime dahil olmayan tahsilatlar da listelenir. Varsayılan: false */
  includeNonPremium: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .optional()
    .default(false),
  /** Geriye dönük uyumluluk; false gönderilirse tüm tahsilatlar listelenir. Varsayılan: true */
  sadecePrimDahil: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .optional()
    .default(true)
})

export const markPrimOdendiBodySchema = z.object({
  not: z.string().trim().max(2000).optional().nullable()
})

export type CreatePrimKuralBody = z.infer<typeof createPrimKuralBodySchema>
export type UpdatePrimKuralBody = z.infer<typeof updatePrimKuralBodySchema>
export type PrimRaporQuery = z.infer<typeof primRaporQuerySchema>
export type PersonelPanelOzetQuery = z.infer<typeof personelPanelOzetQuerySchema>
export type PersonelPanelDetayQuery = z.infer<typeof personelPanelDetayQuerySchema>
