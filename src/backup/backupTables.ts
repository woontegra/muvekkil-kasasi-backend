/**
 * Tenant backup kapsamı. Prisma model adları schema.prisma ile birebir.
 * Hariç tutulanlar bu listede yoktur.
 */
export type BackupTableScope = 'id' | 'tenantId'

export type BackupTableSpec = {
  model: string
  delegate: string
  scope: BackupTableScope
}

export const EXCLUDED_BACKUP_MODELS = [
  'PasswordResetToken',
  'RefreshSession',
  'AdminRefreshSession',
  'SuperAdmin',
  'AdminAuditLog'
] as const

export const BACKUP_TABLES: readonly BackupTableSpec[] = [
  { model: 'Tenant', delegate: 'tenant', scope: 'id' },
  { model: 'TenantLicenseRenewal', delegate: 'tenantLicenseRenewal', scope: 'tenantId' },
  { model: 'LicensePurchaseSession', delegate: 'licensePurchaseSession', scope: 'tenantId' },
  { model: 'LicenseExpiryReminder', delegate: 'licenseExpiryReminder', scope: 'tenantId' },
  { model: 'User', delegate: 'user', scope: 'tenantId' },
  { model: 'AuditLog', delegate: 'auditLog', scope: 'tenantId' },
  { model: 'Muvekkil', delegate: 'muvekkil', scope: 'tenantId' },
  { model: 'Dosya', delegate: 'dosya', scope: 'tenantId' },
  { model: 'Randevu', delegate: 'randevu', scope: 'tenantId' },
  { model: 'TenantFinansKalemi', delegate: 'tenantFinansKalemi', scope: 'tenantId' },
  { model: 'OfisKasaHareketi', delegate: 'ofisKasaHareketi', scope: 'tenantId' },
  { model: 'KasaHareketi', delegate: 'kasaHareketi', scope: 'tenantId' },
  { model: 'VekaletUcreti', delegate: 'vekaletUcreti', scope: 'tenantId' },
  { model: 'VekaletTaksiti', delegate: 'vekaletTaksiti', scope: 'tenantId' },
  { model: 'VekaletTaksitOdeme', delegate: 'vekaletTaksitOdeme', scope: 'tenantId' },
  { model: 'PrimPersonel', delegate: 'primPersonel', scope: 'tenantId' },
  { model: 'IcraTahsilatAlacagi', delegate: 'icraTahsilatAlacagi', scope: 'tenantId' },
  { model: 'IcraTahsilatTaksit', delegate: 'icraTahsilatTaksit', scope: 'tenantId' },
  { model: 'IcraTahsilatOdeme', delegate: 'icraTahsilatOdeme', scope: 'tenantId' },
  { model: 'PrimKurali', delegate: 'primKurali', scope: 'tenantId' },
  { model: 'PrimKuralKademesi', delegate: 'primKuralKademesi', scope: 'tenantId' },
  { model: 'PrimDonemOdemesi', delegate: 'primDonemOdemesi', scope: 'tenantId' },
  { model: 'ImportBatch', delegate: 'importBatch', scope: 'tenantId' },
  { model: 'TahsilatBildirimAyar', delegate: 'tahsilatBildirimAyar', scope: 'tenantId' },
  { model: 'TahsilatBildirimKurali', delegate: 'tahsilatBildirimKurali', scope: 'tenantId' },
  { model: 'TahsilatBildirimSablonu', delegate: 'tahsilatBildirimSablonu', scope: 'tenantId' },
  { model: 'TahsilatBildirimIsi', delegate: 'tahsilatBildirimIsi', scope: 'tenantId' },
  { model: 'TahsilatBildirimDeneme', delegate: 'tahsilatBildirimDeneme', scope: 'tenantId' },
  { model: 'BildirimPlanEntity', delegate: 'bildirimPlanEntity', scope: 'tenantId' },
  { model: 'BildirimPlanKural', delegate: 'bildirimPlanKural', scope: 'tenantId' },
  { model: 'RandevuBildirimAyar', delegate: 'randevuBildirimAyar', scope: 'tenantId' },
  { model: 'RandevuBildirimVarsayilanKural', delegate: 'randevuBildirimVarsayilanKural', scope: 'tenantId' },
  { model: 'RandevuBildirimIsi', delegate: 'randevuBildirimIsi', scope: 'tenantId' },
  { model: 'SmsTenantBakiye', delegate: 'smsTenantBakiye', scope: 'tenantId' },
  { model: 'SmsKrediHareketi', delegate: 'smsKrediHareketi', scope: 'tenantId' },
  { model: 'WhatsAppMesajKredisi', delegate: 'whatsAppMesajKredisi', scope: 'tenantId' },
  { model: 'WhatsAppMesajKrediHareketi', delegate: 'whatsAppMesajKrediHareketi', scope: 'tenantId' },
  { model: 'WhatsAppMesajPaketTalebi', delegate: 'whatsAppMesajPaketTalebi', scope: 'tenantId' },
  { model: 'WhatsAppBaglanti', delegate: 'whatsAppBaglanti', scope: 'tenantId' },
  { model: 'WhatsAppWebhookEvent', delegate: 'whatsAppWebhookEvent', scope: 'tenantId' },
  { model: 'WhatsAppGelenMesaj', delegate: 'whatsAppGelenMesaj', scope: 'tenantId' },
  { model: 'WhatsAppMetaSablon', delegate: 'whatsAppMetaSablon', scope: 'tenantId' }
] as const

export function shouldBackupTenant(row: { demoMu: boolean; lisansDurumu: string }): boolean {
  if (row.demoMu === true) return false
  if (row.lisansDurumu === 'DEMO') return false
  return true
}
