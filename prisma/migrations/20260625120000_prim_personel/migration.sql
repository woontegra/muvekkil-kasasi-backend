-- Prim personel tablosu ve tahsilat/prim bağlantıları

CREATE TABLE IF NOT EXISTS "prim_personel" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "ad_soyad" TEXT NOT NULL,
  "telefon" TEXT,
  "eposta" TEXT,
  "unvan" TEXT,
  "aktif_mi" BOOLEAN NOT NULL DEFAULT true,
  "not" TEXT,
  "bagli_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "prim_personel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "prim_personel_bagli_user_id_key" ON "prim_personel"("bagli_user_id");
CREATE INDEX IF NOT EXISTS "prim_personel_tenant_id_aktif_mi_idx" ON "prim_personel"("tenant_id", "aktif_mi");
CREATE INDEX IF NOT EXISTS "prim_personel_tenant_id_ad_soyad_idx" ON "prim_personel"("tenant_id", "ad_soyad");

DO $$ BEGIN
  ALTER TABLE "prim_personel" ADD CONSTRAINT "prim_personel_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "prim_personel" ADD CONSTRAINT "prim_personel_bagli_user_id_fkey"
    FOREIGN KEY ("bagli_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "kasa_hareketi" ADD COLUMN IF NOT EXISTS "tahsilati_yapan_personel_id" TEXT;
ALTER TABLE "vekalet_taksit_odeme" ADD COLUMN IF NOT EXISTS "tahsilati_yapan_personel_id" TEXT;
ALTER TABLE "ofis_kasa_hareketi" ADD COLUMN IF NOT EXISTS "tahsilati_yapan_personel_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "kasa_hareketi" ADD CONSTRAINT "kasa_hareketi_tahsilati_yapan_personel_id_fkey"
    FOREIGN KEY ("tahsilati_yapan_personel_id") REFERENCES "prim_personel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "vekalet_taksit_odeme" ADD CONSTRAINT "vekalet_taksit_odeme_tahsilati_yapan_personel_id_fkey"
    FOREIGN KEY ("tahsilati_yapan_personel_id") REFERENCES "prim_personel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ofis_kasa_hareketi" ADD CONSTRAINT "ofis_kasa_hareketi_tahsilati_yapan_personel_id_fkey"
    FOREIGN KEY ("tahsilati_yapan_personel_id") REFERENCES "prim_personel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "kasa_hareketi_tenant_id_tahsilati_yapan_personel_id_tarih_idx"
  ON "kasa_hareketi"("tenant_id", "tahsilati_yapan_personel_id", "tarih");
CREATE INDEX IF NOT EXISTS "vekalet_taksit_odeme_tenant_id_tahsilati_yapan_personel_id_odeme_tarihi_idx"
  ON "vekalet_taksit_odeme"("tenant_id", "tahsilati_yapan_personel_id", "odeme_tarihi");
CREATE INDEX IF NOT EXISTS "ofis_kasa_hareketi_tenant_id_tahsilati_yapan_personel_id_tarih_idx"
  ON "ofis_kasa_hareketi"("tenant_id", "tahsilati_yapan_personel_id", "tarih");

ALTER TABLE "prim_kurali" ADD COLUMN IF NOT EXISTS "prim_personel_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "prim_kurali" ADD CONSTRAINT "prim_kurali_prim_personel_id_fkey"
    FOREIGN KEY ("prim_personel_id") REFERENCES "prim_personel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "prim_kurali_tenant_id_kapsam_prim_personel_id_idx"
  ON "prim_kurali"("tenant_id", "kapsam", "prim_personel_id");

ALTER TABLE "prim_donem_odemesi" ADD COLUMN IF NOT EXISTS "prim_personel_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "prim_donem_odemesi" ADD CONSTRAINT "prim_donem_odemesi_prim_personel_id_fkey"
    FOREIGN KEY ("prim_personel_id") REFERENCES "prim_personel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "prim_donem_odemesi" ALTER COLUMN "user_id" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "prim_donem_odemesi_tenant_id_prim_personel_id_yil_ay_key"
  ON "prim_donem_odemesi"("tenant_id", "prim_personel_id", "yil", "ay");
