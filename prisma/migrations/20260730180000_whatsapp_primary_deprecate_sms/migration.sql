-- WhatsApp birincil kanal; SMS geçmişi korunur (enum değeri silinmez).
-- Yeni job/kural/şablon varsayılanı WHATSAPP.
-- Provider ayrımı: MANUAL_WHATSAPP | WHATSAPP_CLOUD_API
-- WhatsApp hesap durumları genişletilir (eski değerler korunur).
-- Not: Yeni enum değerleri aynı transaction içinde UPDATE ile kullanılamaz;
-- DISABLED güncellemesi sonraki migration'da yapılır.

ALTER TYPE "WhatsAppBaglantiDurumu" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "WhatsAppBaglantiDurumu" ADD VALUE IF NOT EXISTS 'ACTIVE';
ALTER TYPE "WhatsAppBaglantiDurumu" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "WhatsAppBaglantiDurumu" ADD VALUE IF NOT EXISTS 'DISABLED';

DO $$ BEGIN
  CREATE TYPE "BildirimProvider" AS ENUM ('MANUAL_WHATSAPP', 'WHATSAPP_CLOUD_API');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "tahsilat_bildirim_isi"
  ADD COLUMN IF NOT EXISTS "provider" "BildirimProvider";

ALTER TABLE "tahsilat_bildirim_kurali"
  ALTER COLUMN "kanal" SET DEFAULT 'WHATSAPP';

ALTER TABLE "tahsilat_bildirim_sablonu"
  ALTER COLUMN "kanal" SET DEFAULT 'WHATSAPP';

ALTER TABLE "tahsilat_bildirim_isi"
  ALTER COLUMN "kanal" SET DEFAULT 'WHATSAPP';

-- SMS otomatik üretim bayrağını kapalı tut (geçmiş kolon; yeni kullanım yok).
UPDATE "tahsilat_bildirim_ayar"
SET "otomatik_sms_aktif" = false
WHERE "otomatik_sms_aktif" = true;
