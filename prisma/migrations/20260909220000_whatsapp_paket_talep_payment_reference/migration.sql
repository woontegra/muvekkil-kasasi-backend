-- WhatsApp paket talebi: kullanıcı dostu ödeme referansı (Havale/EFT açıklaması).
-- Additive only. Production'a bu dosyayı deploy etmeden önce onay gerekir.

ALTER TABLE "whatsapp_mesaj_paket_talebi"
  ADD COLUMN IF NOT EXISTS "payment_reference" TEXT;

-- Mevcut satırları benzersiz referansla doldur (WA-YYYYMMDD-XXXX).
UPDATE "whatsapp_mesaj_paket_talebi" t
SET "payment_reference" = (
  'WA-' ||
  to_char(t."created_at" AT TIME ZONE 'UTC', 'YYYYMMDD') ||
  '-' ||
  lpad((abs(hashtext(t."id")) % 9000 + 1000)::text, 4, '0')
)
WHERE t."payment_reference" IS NULL OR btrim(t."payment_reference") = '';

-- Nadir çakışmalarda id tabanlı yedek suffix.
UPDATE "whatsapp_mesaj_paket_talebi" t
SET "payment_reference" = (
  'WA-' ||
  to_char(t."created_at" AT TIME ZONE 'UTC', 'YYYYMMDD') ||
  '-' ||
  upper(substr(replace(t."id", '-', ''), 1, 4))
)
WHERE t."id" IN (
  SELECT a."id"
  FROM "whatsapp_mesaj_paket_talebi" a
  INNER JOIN "whatsapp_mesaj_paket_talebi" b
    ON a."payment_reference" = b."payment_reference"
   AND a."id" <> b."id"
);

ALTER TABLE "whatsapp_mesaj_paket_talebi"
  ALTER COLUMN "payment_reference" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_mesaj_paket_talebi_payment_reference_key"
  ON "whatsapp_mesaj_paket_talebi"("payment_reference");
