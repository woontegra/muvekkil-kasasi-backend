-- Additive: WhatsApp hazır şablon kütüphanesi alanları
-- Production’a bu oturumda uygulanmaz; migrate deploy ayrı onay ister.

ALTER TABLE "whatsapp_meta_sablon"
  ADD COLUMN IF NOT EXISTS "library_key" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_waba_id" TEXT,
  ADD COLUMN IF NOT EXISTS "meta_template_id" TEXT,
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "components_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "parameter_format" TEXT,
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_meta_sablon_library_key_provider_waba_id_key"
  ON "whatsapp_meta_sablon" ("library_key", "provider_waba_id")
  WHERE "library_key" IS NOT NULL AND "provider_waba_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "whatsapp_meta_sablon_library_key_idx"
  ON "whatsapp_meta_sablon" ("library_key");

CREATE INDEX IF NOT EXISTS "whatsapp_meta_sablon_provider_waba_id_idx"
  ON "whatsapp_meta_sablon" ("provider_waba_id");

ALTER TABLE "tahsilat_bildirim_kurali"
  ADD COLUMN IF NOT EXISTS "meta_sablon_id" TEXT,
  ADD COLUMN IF NOT EXISTS "library_key" TEXT;

CREATE INDEX IF NOT EXISTS "tahsilat_bildirim_kurali_meta_sablon_id_idx"
  ON "tahsilat_bildirim_kurali" ("meta_sablon_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tahsilat_bildirim_kurali_meta_sablon_id_fkey'
  ) THEN
    ALTER TABLE "tahsilat_bildirim_kurali"
      ADD CONSTRAINT "tahsilat_bildirim_kurali_meta_sablon_id_fkey"
      FOREIGN KEY ("meta_sablon_id") REFERENCES "whatsapp_meta_sablon"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
