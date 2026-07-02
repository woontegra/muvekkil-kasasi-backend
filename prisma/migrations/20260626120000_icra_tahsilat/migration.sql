-- CreateEnum
CREATE TYPE "IcraTahsilatAlacakTuru" AS ENUM ('KARSI_TARAF_VEKALET', 'ICRA_VEKALET');

-- CreateEnum
CREATE TYPE "IcraTahsilatAlacakDurum" AS ENUM ('ACIK', 'KISMI_ODENDI', 'ODENDI', 'GECIKTI', 'IPTAL');

-- AlterTable
ALTER TABLE "ofis_kasa_hareketi" ADD COLUMN "kaynak_tipi" TEXT,
ADD COLUMN "kaynak_id" TEXT;

-- CreateTable
CREATE TABLE "icra_tahsilat_alacak" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "alacak_turu" "IcraTahsilatAlacakTuru" NOT NULL,
    "borclu_ad" TEXT NOT NULL,
    "muvekkil_id" TEXT,
    "dosya_id" TEXT,
    "toplam_tutar" DECIMAL(14,2) NOT NULL,
    "pesinat_tutar" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taksit_sayisi" INTEGER NOT NULL,
    "ilk_vade_tarihi" TIMESTAMP(3) NOT NULL,
    "varsayilan_odeme_yontemi" "OfisKasaOdemeYontemi" NOT NULL,
    "aciklama" TEXT,
    "durum" "IcraTahsilatAlacakDurum" NOT NULL DEFAULT 'ACIK',
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "icra_tahsilat_alacak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icra_tahsilat_taksit" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "alacak_id" TEXT NOT NULL,
    "taksit_no" INTEGER NOT NULL,
    "tutar" DECIMAL(14,2) NOT NULL,
    "vade_tarihi" TIMESTAMP(3) NOT NULL,
    "aciklama" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "icra_tahsilat_taksit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icra_tahsilat_odeme" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "alacak_id" TEXT NOT NULL,
    "taksit_id" TEXT,
    "odeme_tarihi" TIMESTAMP(3) NOT NULL,
    "tutar" DECIMAL(14,2) NOT NULL,
    "odeme_yontemi" "OfisKasaOdemeYontemi" NOT NULL,
    "aciklama" TEXT,
    "smm_kesildi_mi" BOOLEAN NOT NULL DEFAULT false,
    "pesinat_mi" BOOLEAN NOT NULL DEFAULT false,
    "ofis_kasa_hareket_id" TEXT,
    "tahsilati_yapan_personel_id" TEXT,
    "tahsilati_yapan_user_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "icra_tahsilat_odeme_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "icra_tahsilat_alacak_tenant_id_durum_idx" ON "icra_tahsilat_alacak"("tenant_id", "durum");

-- CreateIndex
CREATE INDEX "icra_tahsilat_alacak_tenant_id_created_at_idx" ON "icra_tahsilat_alacak"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "icra_tahsilat_alacak_tenant_id_muvekkil_id_idx" ON "icra_tahsilat_alacak"("tenant_id", "muvekkil_id");

-- CreateIndex
CREATE INDEX "icra_tahsilat_alacak_tenant_id_dosya_id_idx" ON "icra_tahsilat_alacak"("tenant_id", "dosya_id");

-- CreateIndex
CREATE INDEX "icra_tahsilat_taksit_tenant_id_alacak_id_idx" ON "icra_tahsilat_taksit"("tenant_id", "alacak_id");

-- CreateIndex
CREATE UNIQUE INDEX "icra_tahsilat_taksit_alacak_id_taksit_no_key" ON "icra_tahsilat_taksit"("alacak_id", "taksit_no");

-- CreateIndex
CREATE UNIQUE INDEX "icra_tahsilat_odeme_ofis_kasa_hareket_id_key" ON "icra_tahsilat_odeme"("ofis_kasa_hareket_id");

-- CreateIndex
CREATE INDEX "icra_tahsilat_odeme_tenant_id_alacak_id_idx" ON "icra_tahsilat_odeme"("tenant_id", "alacak_id");

-- CreateIndex
CREATE INDEX "icra_tahsilat_odeme_tenant_id_taksit_id_idx" ON "icra_tahsilat_odeme"("tenant_id", "taksit_id");

-- CreateIndex
CREATE INDEX "icra_tahsilat_odeme_tenant_id_tahsilati_yapan_personel_id_od_idx" ON "icra_tahsilat_odeme"("tenant_id", "tahsilati_yapan_personel_id", "odeme_tarihi");

-- CreateIndex
CREATE INDEX "icra_tahsilat_odeme_tenant_id_smm_kesildi_mi_idx" ON "icra_tahsilat_odeme"("tenant_id", "smm_kesildi_mi");

-- CreateIndex
CREATE UNIQUE INDEX "ofis_kasa_hareketi_tenant_id_kaynak_tipi_kaynak_id_key" ON "ofis_kasa_hareketi"("tenant_id", "kaynak_tipi", "kaynak_id");

-- AddForeignKey
ALTER TABLE "icra_tahsilat_alacak" ADD CONSTRAINT "icra_tahsilat_alacak_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_alacak" ADD CONSTRAINT "icra_tahsilat_alacak_muvekkil_id_fkey" FOREIGN KEY ("muvekkil_id") REFERENCES "muvekkil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_alacak" ADD CONSTRAINT "icra_tahsilat_alacak_dosya_id_fkey" FOREIGN KEY ("dosya_id") REFERENCES "dosya"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_alacak" ADD CONSTRAINT "icra_tahsilat_alacak_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_alacak" ADD CONSTRAINT "icra_tahsilat_alacak_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_taksit" ADD CONSTRAINT "icra_tahsilat_taksit_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_taksit" ADD CONSTRAINT "icra_tahsilat_taksit_alacak_id_fkey" FOREIGN KEY ("alacak_id") REFERENCES "icra_tahsilat_alacak"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_odeme" ADD CONSTRAINT "icra_tahsilat_odeme_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_odeme" ADD CONSTRAINT "icra_tahsilat_odeme_alacak_id_fkey" FOREIGN KEY ("alacak_id") REFERENCES "icra_tahsilat_alacak"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_odeme" ADD CONSTRAINT "icra_tahsilat_odeme_taksit_id_fkey" FOREIGN KEY ("taksit_id") REFERENCES "icra_tahsilat_taksit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_odeme" ADD CONSTRAINT "icra_tahsilat_odeme_ofis_kasa_hareket_id_fkey" FOREIGN KEY ("ofis_kasa_hareket_id") REFERENCES "ofis_kasa_hareketi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_odeme" ADD CONSTRAINT "icra_tahsilat_odeme_tahsilati_yapan_personel_id_fkey" FOREIGN KEY ("tahsilati_yapan_personel_id") REFERENCES "prim_personel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_odeme" ADD CONSTRAINT "icra_tahsilat_odeme_tahsilati_yapan_user_id_fkey" FOREIGN KEY ("tahsilati_yapan_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icra_tahsilat_odeme" ADD CONSTRAINT "icra_tahsilat_odeme_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
