-- Additive / geriye uyumlu: TenantFinansKalemi + nullable kalem_id FK’leri.
-- Mevcut kategori/masraf_turu metinleri ve tutarlar DEĞİŞMEZ.
-- Railway production’da yalnız açık onay ile: prisma migrate deploy

-- CreateEnum
CREATE TYPE "FinansKalemTuru" AS ENUM ('GELIR', 'GIDER');

-- CreateTable
CREATE TABLE "tenant_finans_kalemi" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tur" "FinansKalemTuru" NOT NULL,
    "kod" TEXT,
    "ad" TEXT NOT NULL,
    "normalize_ad" TEXT NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "sistem_mi" BOOLEAN NOT NULL DEFAULT false,
    "sira" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_finans_kalemi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_finans_kalemi_tenant_id_tur_normalize_ad_key"
  ON "tenant_finans_kalemi"("tenant_id", "tur", "normalize_ad");

-- Partial unique: aynı tenant’ta sistem kodu tekrarlanmasın (NULL kod serbest)
CREATE UNIQUE INDEX "tenant_finans_kalemi_tenant_id_kod_key"
  ON "tenant_finans_kalemi"("tenant_id", "kod")
  WHERE "kod" IS NOT NULL;

CREATE INDEX "tenant_finans_kalemi_tenant_id_tur_aktif_sira_idx"
  ON "tenant_finans_kalemi"("tenant_id", "tur", "aktif", "sira");

-- AddForeignKey
ALTER TABLE "tenant_finans_kalemi"
  ADD CONSTRAINT "tenant_finans_kalemi_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_finans_kalemi"
  ADD CONSTRAINT "tenant_finans_kalemi_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tenant_finans_kalemi"
  ADD CONSTRAINT "tenant_finans_kalemi_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Ofis kasa: nullable kalem bağlantısı (kategori metni snapshot kalır)
ALTER TABLE "ofis_kasa_hareketi" ADD COLUMN "kalem_id" TEXT;

CREATE INDEX "ofis_kasa_hareketi_tenant_id_kalem_id_idx"
  ON "ofis_kasa_hareketi"("tenant_id", "kalem_id");

ALTER TABLE "ofis_kasa_hareketi"
  ADD CONSTRAINT "ofis_kasa_hareketi_kalem_id_fkey"
  FOREIGN KEY ("kalem_id") REFERENCES "tenant_finans_kalemi"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Dosya kasa: nullable kalem bağlantısı (masraf_turu snapshot kalır)
ALTER TABLE "kasa_hareketi" ADD COLUMN "kalem_id" TEXT;

CREATE INDEX "kasa_hareketi_tenant_id_kalem_id_idx"
  ON "kasa_hareketi"("tenant_id", "kalem_id");

ALTER TABLE "kasa_hareketi"
  ADD CONSTRAINT "kasa_hareketi_kalem_id_fkey"
  FOREIGN KEY ("kalem_id") REFERENCES "tenant_finans_kalemi"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
