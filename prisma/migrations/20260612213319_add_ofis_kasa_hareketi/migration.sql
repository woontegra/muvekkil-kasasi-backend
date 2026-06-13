-- CreateEnum
CREATE TYPE "OfisKasaIslemTipi" AS ENUM ('GELIR', 'GIDER', 'DUZELTME');

-- CreateEnum
CREATE TYPE "OfisKasaOnayDurumu" AS ENUM ('ONAYSIZ', 'ONAYLI', 'REDDEDILDI');

-- CreateEnum
CREATE TYPE "OfisKasaOdemeYontemi" AS ENUM ('NAKIT', 'BANKA', 'KREDI_KARTI', 'DIGER');

-- CreateTable
CREATE TABLE "ofis_kasa_hareketi" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "islem_tipi" "OfisKasaIslemTipi" NOT NULL,
    "tarih" TIMESTAMP(3) NOT NULL,
    "kategori" TEXT NOT NULL,
    "ozel_kategori_adi" TEXT,
    "aciklama" TEXT,
    "tutar" DECIMAL(14,2) NOT NULL,
    "odeme_yontemi" "OfisKasaOdemeYontemi" NOT NULL,
    "belge_no" TEXT NOT NULL,
    "onay_durumu" "OfisKasaOnayDurumu" NOT NULL DEFAULT 'ONAYSIZ',
    "onaylayan_id" TEXT,
    "onay_tarihi" TIMESTAMP(3),
    "red_sebebi" TEXT,
    "orijinal_hareket_id" TEXT,
    "otomatik_onay_mi" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ofis_kasa_hareketi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ofis_kasa_hareketi_tenant_id_tarih_idx" ON "ofis_kasa_hareketi"("tenant_id", "tarih");

-- CreateIndex
CREATE INDEX "ofis_kasa_hareketi_tenant_id_onay_durumu_idx" ON "ofis_kasa_hareketi"("tenant_id", "onay_durumu");

-- CreateIndex
CREATE INDEX "ofis_kasa_hareketi_tenant_id_islem_tipi_idx" ON "ofis_kasa_hareketi"("tenant_id", "islem_tipi");

-- CreateIndex
CREATE UNIQUE INDEX "ofis_kasa_hareketi_tenant_id_belge_no_key" ON "ofis_kasa_hareketi"("tenant_id", "belge_no");

-- AddForeignKey
ALTER TABLE "ofis_kasa_hareketi" ADD CONSTRAINT "ofis_kasa_hareketi_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofis_kasa_hareketi" ADD CONSTRAINT "ofis_kasa_hareketi_onaylayan_id_fkey" FOREIGN KEY ("onaylayan_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofis_kasa_hareketi" ADD CONSTRAINT "ofis_kasa_hareketi_orijinal_hareket_id_fkey" FOREIGN KEY ("orijinal_hareket_id") REFERENCES "ofis_kasa_hareketi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofis_kasa_hareketi" ADD CONSTRAINT "ofis_kasa_hareketi_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofis_kasa_hareketi" ADD CONSTRAINT "ofis_kasa_hareketi_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
