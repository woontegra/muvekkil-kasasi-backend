-- SMS kanalını mevcut bildirim modeline ekler (additive).
-- Not: PG, yeni enum değerinin aynı transaction içinde DEFAULT olarak
-- kullanılmasına izin vermez; SET DEFAULT sonraki migration'da (WHATSAPP) yapılır.
ALTER TYPE "BildirimKanali" ADD VALUE IF NOT EXISTS 'SMS';

-- Tenant bazlı SMS ayarları.
ALTER TABLE "tahsilat_bildirim_ayar"
  ADD COLUMN IF NOT EXISTS "otomatik_sms_aktif" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "dusuk_sms_bakiye_esigi" INTEGER NOT NULL DEFAULT 100;

-- Bildirim işi SMS/rapor/provider alanları.
ALTER TABLE "tahsilat_bildirim_isi"
  ADD COLUMN IF NOT EXISTS "sms_parca_sayisi" INTEGER,
  ADD COLUMN IF NOT EXISTS "sms_kredi_tuketimi" INTEGER,
  ADD COLUMN IF NOT EXISTS "telefon_maskeli" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_adi" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_message_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_bulk_id" TEXT,
  ADD COLUMN IF NOT EXISTS "son_provider_hata_kodu" TEXT,
  ADD COLUMN IF NOT EXISTS "rapor_sonraki_sorgu_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rapor_sorgu_deneme" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "manuel_tetikleme" BOOLEAN NOT NULL DEFAULT false;

-- Tenant SMS cüzdanı.
CREATE TABLE IF NOT EXISTS "sms_tenant_bakiye" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL UNIQUE REFERENCES "tenant"("id") ON DELETE CASCADE,
  "mevcut_bakiye" INTEGER NOT NULL DEFAULT 0,
  "toplam_yuklenen" INTEGER NOT NULL DEFAULT 0,
  "toplam_tuketilen" INTEGER NOT NULL DEFAULT 0,
  "toplam_iade_edilen" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SmsKrediHareketTuru') THEN
    CREATE TYPE "SmsKrediHareketTuru" AS ENUM (
      'MANUEL_YUKLEME',
      'REZERVE',
      'TUKETIM',
      'REZERV_IPTALI',
      'IADE',
      'DUZELTME'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "sms_kredi_hareketi" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id") ON DELETE CASCADE,
  "bildirim_isi_id" TEXT REFERENCES "tahsilat_bildirim_isi"("id") ON DELETE SET NULL,
  "tur" "SmsKrediHareketTuru" NOT NULL,
  "miktar" INTEGER NOT NULL,
  "onceki_bakiye" INTEGER NOT NULL,
  "sonraki_bakiye" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "aciklama" TEXT,
  "olusturan_user_id" TEXT,
  "olusturan_admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "sms_kredi_hareketi_tenant_id_idempotency_key_key"
  ON "sms_kredi_hareketi"("tenant_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "sms_kredi_hareketi_tenant_id_created_at_idx"
  ON "sms_kredi_hareketi"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "sms_kredi_hareketi_bildirim_isi_id_idx"
  ON "sms_kredi_hareketi"("bildirim_isi_id");
