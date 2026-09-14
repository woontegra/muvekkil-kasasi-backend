-- Çoklu para birimi (TRY / USD / EUR)
-- Mevcut tutarlar ve bakiyeler değişmez; tüm mevcut kayıtlar TRY kabul edilir.

-- Enum'lar
CREATE TYPE "ParaBirimi" AS ENUM ('TRY', 'USD', 'EUR');

ALTER TYPE "OfisKasaIslemTipi" ADD VALUE 'DOVIZ_CIKIS';
ALTER TYPE "OfisKasaIslemTipi" ADD VALUE 'DOVIZ_GIRIS';

-- Vekalet ücreti
ALTER TABLE "vekalet_ucreti"
  ADD COLUMN "para_birimi" "ParaBirimi" NOT NULL DEFAULT 'TRY';

-- Vekalet taksiti
ALTER TABLE "vekalet_taksiti"
  ADD COLUMN "para_birimi" "ParaBirimi" NOT NULL DEFAULT 'TRY';

-- Vekalet taksit ödeme: önce nullable kolonlar, backfill, sonra NOT NULL
ALTER TABLE "vekalet_taksit_odeme"
  ADD COLUMN "kasa_tutari" DECIMAL(14, 2),
  ADD COLUMN "alacak_para_birimi" "ParaBirimi" NOT NULL DEFAULT 'TRY',
  ADD COLUMN "odeme_para_birimi" "ParaBirimi" NOT NULL DEFAULT 'TRY',
  ADD COLUMN "kur" DECIMAL(24, 8),
  ADD COLUMN "kur_baz_para_birimi" "ParaBirimi",
  ADD COLUMN "kur_karsi_para_birimi" "ParaBirimi";

UPDATE "vekalet_taksit_odeme"
SET "kasa_tutari" = "tutar"
WHERE "kasa_tutari" IS NULL;

ALTER TABLE "vekalet_taksit_odeme"
  ALTER COLUMN "kasa_tutari" SET NOT NULL;

-- İcra tahsilat alacağı / taksit
ALTER TABLE "icra_tahsilat_alacak"
  ADD COLUMN "para_birimi" "ParaBirimi" NOT NULL DEFAULT 'TRY';

ALTER TABLE "icra_tahsilat_taksit"
  ADD COLUMN "para_birimi" "ParaBirimi" NOT NULL DEFAULT 'TRY';

ALTER TABLE "icra_tahsilat_odeme"
  ADD COLUMN "kasa_tutari" DECIMAL(14, 2),
  ADD COLUMN "alacak_para_birimi" "ParaBirimi" NOT NULL DEFAULT 'TRY',
  ADD COLUMN "odeme_para_birimi" "ParaBirimi" NOT NULL DEFAULT 'TRY',
  ADD COLUMN "kur" DECIMAL(24, 8),
  ADD COLUMN "kur_baz_para_birimi" "ParaBirimi",
  ADD COLUMN "kur_karsi_para_birimi" "ParaBirimi";

UPDATE "icra_tahsilat_odeme"
SET "kasa_tutari" = "tutar"
WHERE "kasa_tutari" IS NULL;

ALTER TABLE "icra_tahsilat_odeme"
  ALTER COLUMN "kasa_tutari" SET NOT NULL;

-- Ofis kasa hareketi
ALTER TABLE "ofis_kasa_hareketi"
  ADD COLUMN "para_birimi" "ParaBirimi" NOT NULL DEFAULT 'TRY',
  ADD COLUMN "doviz_donusum_id" TEXT,
  ADD COLUMN "kur" DECIMAL(24, 8),
  ADD COLUMN "kur_baz_para_birimi" "ParaBirimi",
  ADD COLUMN "kur_karsi_para_birimi" "ParaBirimi";

CREATE INDEX "ofis_kasa_hareketi_tenant_id_para_birimi_tarih_idx"
  ON "ofis_kasa_hareketi"("tenant_id", "para_birimi", "tarih");

CREATE INDEX "ofis_kasa_hareketi_tenant_id_doviz_donusum_id_idx"
  ON "ofis_kasa_hareketi"("tenant_id", "doviz_donusum_id");

CREATE INDEX "vekalet_ucreti_tenant_id_para_birimi_idx"
  ON "vekalet_ucreti"("tenant_id", "para_birimi");

CREATE INDEX "icra_tahsilat_alacak_tenant_id_para_birimi_idx"
  ON "icra_tahsilat_alacak"("tenant_id", "para_birimi");
