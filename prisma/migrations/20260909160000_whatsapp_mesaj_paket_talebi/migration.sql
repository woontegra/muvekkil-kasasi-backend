-- WhatsApp mesaj paketi satın alma talepleri (manuel admin onayı).
-- Production-safe: additive only. Website checkout akışına dokunmaz.

DO $$ BEGIN
  CREATE TYPE "WhatsAppMesajPaketTalepDurum" AS ENUM (
    'BEKLIYOR',
    'ONAYLANDI',
    'REDDEDILDI',
    'IPTAL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "whatsapp_mesaj_paket_talebi" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "package_id" TEXT NOT NULL,
  "mesaj_adedi" INTEGER NOT NULL,
  "fiyat_tl" INTEGER NOT NULL,
  "durum" "WhatsAppMesajPaketTalepDurum" NOT NULL DEFAULT 'BEKLIYOR',
  "admin_notu" TEXT,
  "created_by_user_id" TEXT,
  "resolved_by_admin_id" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_mesaj_paket_talebi_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_mesaj_paket_talebi_mesaj_adedi_pos" CHECK ("mesaj_adedi" > 0),
  CONSTRAINT "whatsapp_mesaj_paket_talebi_fiyat_tl_nonneg" CHECK ("fiyat_tl" >= 0)
);

CREATE INDEX IF NOT EXISTS "whatsapp_mesaj_paket_talebi_tenant_id_durum_created_at_idx"
  ON "whatsapp_mesaj_paket_talebi"("tenant_id", "durum", "created_at");

CREATE INDEX IF NOT EXISTS "whatsapp_mesaj_paket_talebi_durum_created_at_idx"
  ON "whatsapp_mesaj_paket_talebi"("durum", "created_at");

CREATE INDEX IF NOT EXISTS "whatsapp_mesaj_paket_talebi_tenant_id_package_id_durum_idx"
  ON "whatsapp_mesaj_paket_talebi"("tenant_id", "package_id", "durum");

-- Aynı tenant + paket için yalnız bir bekleyen talep.
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_mesaj_paket_talebi_tenant_package_bekliyor_uidx"
  ON "whatsapp_mesaj_paket_talebi"("tenant_id", "package_id")
  WHERE "durum" = 'BEKLIYOR';

DO $$ BEGIN
  ALTER TABLE "whatsapp_mesaj_paket_talebi"
    ADD CONSTRAINT "whatsapp_mesaj_paket_talebi_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
