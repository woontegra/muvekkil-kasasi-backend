-- WhatsApp Cloud API tenant bağlantısı (additive).
-- Enum: BAGLANIYOR, BAGLANTI_KESILDI
-- WhatsAppBaglanti alanları + webhook/gelen mesaj/meta şablon tabloları.
-- Not: Yeni enum değerleri aynı transaction içinde UPDATE ile kullanılamaz.

ALTER TYPE "WhatsAppBaglantiDurumu" ADD VALUE IF NOT EXISTS 'BAGLANIYOR';
ALTER TYPE "WhatsAppBaglantiDurumu" ADD VALUE IF NOT EXISTS 'BAGLANTI_KESILDI';

ALTER TABLE "whatsapp_baglanti"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'META_CLOUD',
  ADD COLUMN IF NOT EXISTS "waba_id" TEXT,
  ADD COLUMN IF NOT EXISTS "phone_number_id" TEXT,
  ADD COLUMN IF NOT EXISTS "display_phone_number" TEXT,
  ADD COLUMN IF NOT EXISTS "verified_name" TEXT,
  ADD COLUMN IF NOT EXISTS "business_account_name" TEXT,
  ADD COLUMN IF NOT EXISTS "token_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "webhook_override_active" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "webhook_override_callback" TEXT,
  ADD COLUMN IF NOT EXISTS "connected_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disconnected_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_webhook_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_baglanti_phone_number_id_key"
  ON "whatsapp_baglanti"("phone_number_id");

CREATE INDEX IF NOT EXISTS "whatsapp_baglanti_phone_number_id_idx"
  ON "whatsapp_baglanti"("phone_number_id");

CREATE INDEX IF NOT EXISTS "whatsapp_baglanti_waba_id_idx"
  ON "whatsapp_baglanti"("waba_id");

CREATE TABLE IF NOT EXISTS "whatsapp_webhook_event" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "baglanti_id" TEXT,
  "meta_event_id" TEXT NOT NULL,
  "phone_number_id" TEXT,
  "waba_id" TEXT,
  "event_type" TEXT NOT NULL,
  "status_raw" TEXT,
  "provider_message_id" TEXT,
  "processed_ok" BOOLEAN NOT NULL DEFAULT false,
  "error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_webhook_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_webhook_event_meta_event_id_key"
  ON "whatsapp_webhook_event"("meta_event_id");

CREATE INDEX IF NOT EXISTS "whatsapp_webhook_event_tenant_id_idx"
  ON "whatsapp_webhook_event"("tenant_id");

CREATE INDEX IF NOT EXISTS "whatsapp_webhook_event_phone_number_id_idx"
  ON "whatsapp_webhook_event"("phone_number_id");

CREATE TABLE IF NOT EXISTS "whatsapp_gelen_mesaj" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "baglanti_id" TEXT NOT NULL,
  "meta_message_id" TEXT NOT NULL,
  "message_type" TEXT NOT NULL,
  "sender_masked" TEXT NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL,
  "processed_durum" TEXT NOT NULL DEFAULT 'ALINDI',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_gelen_mesaj_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_gelen_mesaj_meta_message_id_key"
  ON "whatsapp_gelen_mesaj"("meta_message_id");

CREATE INDEX IF NOT EXISTS "whatsapp_gelen_mesaj_tenant_id_idx"
  ON "whatsapp_gelen_mesaj"("tenant_id");

CREATE INDEX IF NOT EXISTS "whatsapp_gelen_mesaj_baglanti_id_idx"
  ON "whatsapp_gelen_mesaj"("baglanti_id");

CREATE TABLE IF NOT EXISTS "whatsapp_meta_sablon" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "baglanti_id" TEXT,
  "meta_name" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "status_normalized" TEXT NOT NULL,
  "category" TEXT,
  "last_synced_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_meta_sablon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_meta_sablon_tenant_id_meta_name_language_key"
  ON "whatsapp_meta_sablon"("tenant_id", "meta_name", "language");

CREATE INDEX IF NOT EXISTS "whatsapp_meta_sablon_tenant_id_idx"
  ON "whatsapp_meta_sablon"("tenant_id");

CREATE INDEX IF NOT EXISTS "whatsapp_meta_sablon_baglanti_id_idx"
  ON "whatsapp_meta_sablon"("baglanti_id");

DO $$ BEGIN
  ALTER TABLE "whatsapp_webhook_event"
    ADD CONSTRAINT "whatsapp_webhook_event_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_webhook_event"
    ADD CONSTRAINT "whatsapp_webhook_event_baglanti_id_fkey"
    FOREIGN KEY ("baglanti_id") REFERENCES "whatsapp_baglanti"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_gelen_mesaj"
    ADD CONSTRAINT "whatsapp_gelen_mesaj_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_gelen_mesaj"
    ADD CONSTRAINT "whatsapp_gelen_mesaj_baglanti_id_fkey"
    FOREIGN KEY ("baglanti_id") REFERENCES "whatsapp_baglanti"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_meta_sablon"
    ADD CONSTRAINT "whatsapp_meta_sablon_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_meta_sablon"
    ADD CONSTRAINT "whatsapp_meta_sablon_baglanti_id_fkey"
    FOREIGN KEY ("baglanti_id") REFERENCES "whatsapp_baglanti"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
