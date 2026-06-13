-- CreateEnum
CREATE TYPE "KasaHareketTipi" AS ENUM ('AVANS_GIRISI', 'MASRAF', 'DUZELTME');

-- CreateEnum
CREATE TYPE "KasaOnayDurumu" AS ENUM ('ONAYSIZ', 'ONAYLI', 'REDDEDILDI');

-- CreateEnum
CREATE TYPE "OdemeYontemi" AS ENUM ('NAKIT', 'BANKA', 'KREDI_KARTI', 'DIGER');

-- CreateTable
CREATE TABLE "kasa_hareketi" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dosya_id" TEXT NOT NULL,
    "muvekkil_id" TEXT NOT NULL,
    "tip" "KasaHareketTipi" NOT NULL,
    "tarih" TIMESTAMP(3) NOT NULL,
    "masraf_turu" TEXT,
    "ozel_masraf_adi" TEXT,
    "aciklama" TEXT,
    "tutar" DECIMAL(14,2) NOT NULL,
    "odeme_yontemi" "OdemeYontemi" NOT NULL,
    "belge_no" TEXT NOT NULL,
    "onay_durumu" "KasaOnayDurumu" NOT NULL DEFAULT 'ONAYSIZ',
    "onaylayan_id" TEXT,
    "onay_tarihi" TIMESTAMP(3),
    "red_sebebi" TEXT,
    "orijinal_hareket_id" TEXT,
    "otomatik_onay_mi" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kasa_hareketi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kasa_hareketi_tenant_id_belge_no_key" ON "kasa_hareketi"("tenant_id", "belge_no");

-- CreateIndex
CREATE INDEX "kasa_hareketi_tenant_id_dosya_id_tarih_idx" ON "kasa_hareketi"("tenant_id", "dosya_id", "tarih");

-- CreateIndex
CREATE INDEX "kasa_hareketi_tenant_id_dosya_id_onay_durumu_idx" ON "kasa_hareketi"("tenant_id", "dosya_id", "onay_durumu");

-- AddForeignKey
ALTER TABLE "kasa_hareketi" ADD CONSTRAINT "kasa_hareketi_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasa_hareketi" ADD CONSTRAINT "kasa_hareketi_dosya_id_fkey" FOREIGN KEY ("dosya_id") REFERENCES "dosya"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasa_hareketi" ADD CONSTRAINT "kasa_hareketi_muvekkil_id_fkey" FOREIGN KEY ("muvekkil_id") REFERENCES "muvekkil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasa_hareketi" ADD CONSTRAINT "kasa_hareketi_onaylayan_id_fkey" FOREIGN KEY ("onaylayan_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasa_hareketi" ADD CONSTRAINT "kasa_hareketi_orijinal_hareket_id_fkey" FOREIGN KEY ("orijinal_hareket_id") REFERENCES "kasa_hareketi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasa_hareketi" ADD CONSTRAINT "kasa_hareketi_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasa_hareketi" ADD CONSTRAINT "kasa_hareketi_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
