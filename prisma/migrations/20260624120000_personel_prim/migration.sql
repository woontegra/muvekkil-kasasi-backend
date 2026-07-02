-- Personel tahsilat primi modülü + tahsilatı yapan personel alanı

CREATE TYPE "PrimKuralKapsam" AS ENUM ('TENANT_DEFAULT', 'USER_SPECIFIC');
CREATE TYPE "PrimHesaplamaTipi" AS ENUM ('TOTAL_BRACKET', 'PROGRESSIVE');
CREATE TYPE "PrimDonemTipi" AS ENUM ('MONTHLY');
CREATE TYPE "PrimDonemOdemeDurumu" AS ENUM ('HESAPLANDI', 'ODENDI');

ALTER TABLE "kasa_hareketi" ADD COLUMN IF NOT EXISTS "tahsilati_yapan_user_id" TEXT;
ALTER TABLE "vekalet_taksit_odeme" ADD COLUMN IF NOT EXISTS "tahsilati_yapan_user_id" TEXT;
ALTER TABLE "ofis_kasa_hareketi" ADD COLUMN IF NOT EXISTS "tahsilati_yapan_user_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "kasa_hareketi" ADD CONSTRAINT "kasa_hareketi_tahsilati_yapan_user_id_fkey"
    FOREIGN KEY ("tahsilati_yapan_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "vekalet_taksit_odeme" ADD CONSTRAINT "vekalet_taksit_odeme_tahsilati_yapan_user_id_fkey"
    FOREIGN KEY ("tahsilati_yapan_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ofis_kasa_hareketi" ADD CONSTRAINT "ofis_kasa_hareketi_tahsilati_yapan_user_id_fkey"
    FOREIGN KEY ("tahsilati_yapan_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "kasa_hareketi_tenant_id_tahsilati_yapan_user_id_tarih_idx"
  ON "kasa_hareketi"("tenant_id", "tahsilati_yapan_user_id", "tarih");
CREATE INDEX IF NOT EXISTS "vekalet_taksit_odeme_tenant_id_tahsilati_yapan_user_id_odeme_tarihi_idx"
  ON "vekalet_taksit_odeme"("tenant_id", "tahsilati_yapan_user_id", "odeme_tarihi");
CREATE INDEX IF NOT EXISTS "ofis_kasa_hareketi_tenant_id_tahsilati_yapan_user_id_tarih_idx"
  ON "ofis_kasa_hareketi"("tenant_id", "tahsilati_yapan_user_id", "tarih");

CREATE TABLE IF NOT EXISTS "prim_kurali" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "ad" TEXT NOT NULL,
  "aktif_mi" BOOLEAN NOT NULL DEFAULT true,
  "kapsam" "PrimKuralKapsam" NOT NULL,
  "user_id" TEXT,
  "hesaplama_tipi" "PrimHesaplamaTipi" NOT NULL,
  "donem_tipi" "PrimDonemTipi" NOT NULL DEFAULT 'MONTHLY',
  "dosya_tahsilat_mi" BOOLEAN NOT NULL DEFAULT true,
  "vekalet_tahsilat_mi" BOOLEAN NOT NULL DEFAULT true,
  "ofis_kasa_gelir_mi" BOOLEAN NOT NULL DEFAULT true,
  "icra_tahsilat_mi" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "prim_kurali_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "prim_kural_kademesi" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "kural_id" TEXT NOT NULL,
  "min_tutar" DECIMAL(14,2) NOT NULL,
  "max_tutar" DECIMAL(14,2),
  "oran_yuzde" DECIMAL(6,2) NOT NULL,
  "sira_no" INTEGER NOT NULL,
  CONSTRAINT "prim_kural_kademesi_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "prim_donem_odemesi" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "yil" INTEGER NOT NULL,
  "ay" INTEGER NOT NULL,
  "toplam_tahsilat" DECIMAL(14,2) NOT NULL,
  "hesaplanan_prim" DECIMAL(14,2) NOT NULL,
  "uygulanan_kural_id" TEXT,
  "hesaplama_tipi" "PrimHesaplamaTipi",
  "hesaplama_detay" JSONB,
  "durum" "PrimDonemOdemeDurumu" NOT NULL DEFAULT 'HESAPLANDI',
  "odendi_tarihi" TIMESTAMP(3),
  "odendi_isaretleyen_id" TEXT,
  "not" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "prim_donem_odemesi_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "prim_kurali_tenant_id_aktif_mi_idx" ON "prim_kurali"("tenant_id", "aktif_mi");
CREATE INDEX IF NOT EXISTS "prim_kurali_tenant_id_kapsam_user_id_idx" ON "prim_kurali"("tenant_id", "kapsam", "user_id");
CREATE INDEX IF NOT EXISTS "prim_kural_kademesi_tenant_id_kural_id_idx" ON "prim_kural_kademesi"("tenant_id", "kural_id");
CREATE UNIQUE INDEX IF NOT EXISTS "prim_donem_odemesi_tenant_id_user_id_yil_ay_key"
  ON "prim_donem_odemesi"("tenant_id", "user_id", "yil", "ay");
CREATE INDEX IF NOT EXISTS "prim_donem_odemesi_tenant_id_yil_ay_idx" ON "prim_donem_odemesi"("tenant_id", "yil", "ay");

DO $$ BEGIN
  ALTER TABLE "prim_kurali" ADD CONSTRAINT "prim_kurali_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "prim_kurali" ADD CONSTRAINT "prim_kurali_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "prim_kural_kademesi" ADD CONSTRAINT "prim_kural_kademesi_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "prim_kural_kademesi" ADD CONSTRAINT "prim_kural_kademesi_kural_id_fkey"
    FOREIGN KEY ("kural_id") REFERENCES "prim_kurali"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "prim_donem_odemesi" ADD CONSTRAINT "prim_donem_odemesi_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "prim_donem_odemesi" ADD CONSTRAINT "prim_donem_odemesi_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "prim_donem_odemesi" ADD CONSTRAINT "prim_donem_odemesi_odendi_isaretleyen_id_fkey"
    FOREIGN KEY ("odendi_isaretleyen_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
