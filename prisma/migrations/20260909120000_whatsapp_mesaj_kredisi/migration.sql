-- WhatsApp Cloud API mesaj kredi cüzdanı + immutable hareket defteri.
-- Production-safe: additive only. Mevcut tenantlara otomatik +500 yüklenmez.

DO $$ BEGIN
  CREATE TYPE "WhatsAppMesajKrediHareketTipi" AS ENUM (
    'YILLIK_DAHIL',
    'PAKET_SATIN_ALMA',
    'MESAJ_GONDERIM',
    'IADE',
    'MANUEL_DUZELTME'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "whatsapp_mesaj_kredisi" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "bakiye" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_mesaj_kredisi_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_mesaj_kredisi_bakiye_nonneg" CHECK ("bakiye" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_mesaj_kredisi_tenant_id_key"
  ON "whatsapp_mesaj_kredisi"("tenant_id");

DO $$ BEGIN
  ALTER TABLE "whatsapp_mesaj_kredisi"
    ADD CONSTRAINT "whatsapp_mesaj_kredisi_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "whatsapp_mesaj_kredi_hareketi" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "tip" "WhatsAppMesajKrediHareketTipi" NOT NULL,
  "miktar" INTEGER NOT NULL,
  "onceki_bakiye" INTEGER NOT NULL,
  "sonraki_bakiye" INTEGER NOT NULL,
  "job_id" TEXT,
  "payment_id" TEXT,
  "license_period_id" TEXT,
  "aciklama" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_mesaj_kredi_hareketi_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_mesaj_kredi_hareketi_job_id_tip_key"
  ON "whatsapp_mesaj_kredi_hareketi"("job_id", "tip");

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_mesaj_kredi_hareketi_tenant_id_tip_license_period_id_key"
  ON "whatsapp_mesaj_kredi_hareketi"("tenant_id", "tip", "license_period_id");

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_mesaj_kredi_hareketi_tenant_id_tip_payment_id_key"
  ON "whatsapp_mesaj_kredi_hareketi"("tenant_id", "tip", "payment_id");

CREATE INDEX IF NOT EXISTS "whatsapp_mesaj_kredi_hareketi_tenant_id_created_at_idx"
  ON "whatsapp_mesaj_kredi_hareketi"("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "whatsapp_mesaj_kredi_hareketi_job_id_idx"
  ON "whatsapp_mesaj_kredi_hareketi"("job_id");

DO $$ BEGIN
  ALTER TABLE "whatsapp_mesaj_kredi_hareketi"
    ADD CONSTRAINT "whatsapp_mesaj_kredi_hareketi_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
