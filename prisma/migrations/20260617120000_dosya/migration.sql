-- CreateEnum
CREATE TYPE "DosyaDurumu" AS ENUM ('AKTIF', 'PASIF', 'KAPANDI', 'ARSIV');

-- CreateEnum
CREATE TYPE "DosyaTuru" AS ENUM ('DAVA', 'ICRA', 'DANISMANLIK', 'DIGER');

-- CreateTable
CREATE TABLE "dosya" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "muvekkil_id" TEXT NOT NULL,
    "konu_basligi" TEXT NOT NULL,
    "mahkeme" TEXT,
    "icra_dairesi" TEXT,
    "dosya_no" TEXT,
    "dosya_turu" "DosyaTuru" NOT NULL,
    "durum" "DosyaDurumu" NOT NULL,
    "aciklama" TEXT,
    "aktif_mi" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dosya_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dosya_tenant_id_muvekkil_id_aktif_mi_idx" ON "dosya"("tenant_id", "muvekkil_id", "aktif_mi");

-- CreateIndex
CREATE INDEX "dosya_tenant_id_aktif_mi_idx" ON "dosya"("tenant_id", "aktif_mi");

-- AddForeignKey
ALTER TABLE "dosya" ADD CONSTRAINT "dosya_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dosya" ADD CONSTRAINT "dosya_muvekkil_id_fkey" FOREIGN KEY ("muvekkil_id") REFERENCES "muvekkil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dosya" ADD CONSTRAINT "dosya_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dosya" ADD CONSTRAINT "dosya_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
