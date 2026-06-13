-- CreateEnum
CREATE TYPE "VekaletTaksitOdemeDurumu" AS ENUM ('ODENMEDI', 'ODENDI', 'IPTAL');

-- CreateTable
CREATE TABLE "vekalet_ucreti" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dosya_id" TEXT NOT NULL,
    "muvekkil_id" TEXT NOT NULL,
    "toplam_tutar" DECIMAL(14,2) NOT NULL,
    "aciklama" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vekalet_ucreti_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vekalet_taksiti" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dosya_id" TEXT NOT NULL,
    "muvekkil_id" TEXT NOT NULL,
    "vekalet_ucreti_id" TEXT NOT NULL,
    "taksit_no" INTEGER NOT NULL,
    "vade_tarihi" TIMESTAMP(3) NOT NULL,
    "tutar" DECIMAL(14,2) NOT NULL,
    "odeme_durumu" "VekaletTaksitOdemeDurumu" NOT NULL DEFAULT 'ODENMEDI',
    "odeme_tarihi" TIMESTAMP(3),
    "aciklama" TEXT,
    "makbuz_no" TEXT,
    "smm_kesildi_mi" BOOLEAN NOT NULL DEFAULT false,
    "smm_kesim_tarihi" TIMESTAMP(3),
    "smm_no" TEXT,
    "smm_aciklama" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vekalet_taksiti_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vekalet_ucreti_dosya_id_key" ON "vekalet_ucreti"("dosya_id");

-- CreateIndex
CREATE INDEX "vekalet_ucreti_tenant_id_muvekkil_id_idx" ON "vekalet_ucreti"("tenant_id", "muvekkil_id");

-- CreateIndex
CREATE INDEX "vekalet_taksiti_tenant_id_dosya_id_idx" ON "vekalet_taksiti"("tenant_id", "dosya_id");

-- CreateIndex
CREATE INDEX "vekalet_taksiti_tenant_id_dosya_id_odeme_durumu_idx" ON "vekalet_taksiti"("tenant_id", "dosya_id", "odeme_durumu");

-- CreateIndex
CREATE UNIQUE INDEX "vekalet_taksiti_vekalet_ucreti_id_taksit_no_key" ON "vekalet_taksiti"("vekalet_ucreti_id", "taksit_no");

-- AddForeignKey
ALTER TABLE "vekalet_ucreti" ADD CONSTRAINT "vekalet_ucreti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vekalet_ucreti" ADD CONSTRAINT "vekalet_ucreti_dosya_id_fkey" FOREIGN KEY ("dosya_id") REFERENCES "dosya"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vekalet_ucreti" ADD CONSTRAINT "vekalet_ucreti_muvekkil_id_fkey" FOREIGN KEY ("muvekkil_id") REFERENCES "muvekkil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vekalet_ucreti" ADD CONSTRAINT "vekalet_ucreti_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vekalet_ucreti" ADD CONSTRAINT "vekalet_ucreti_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vekalet_taksiti" ADD CONSTRAINT "vekalet_taksiti_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vekalet_taksiti" ADD CONSTRAINT "vekalet_taksiti_dosya_id_fkey" FOREIGN KEY ("dosya_id") REFERENCES "dosya"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vekalet_taksiti" ADD CONSTRAINT "vekalet_taksiti_muvekkil_id_fkey" FOREIGN KEY ("muvekkil_id") REFERENCES "muvekkil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vekalet_taksiti" ADD CONSTRAINT "vekalet_taksiti_vekalet_ucreti_id_fkey" FOREIGN KEY ("vekalet_ucreti_id") REFERENCES "vekalet_ucreti"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vekalet_taksiti" ADD CONSTRAINT "vekalet_taksiti_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vekalet_taksiti" ADD CONSTRAINT "vekalet_taksiti_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
