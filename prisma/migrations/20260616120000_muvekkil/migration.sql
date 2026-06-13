-- CreateEnum
CREATE TYPE "MuvekkilTur" AS ENUM ('GERCEK', 'TUZEL');

-- CreateTable
CREATE TABLE "muvekkil" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tur" "MuvekkilTur" NOT NULL,
    "gorunen_ad" TEXT NOT NULL,
    "ad_soyad" TEXT NOT NULL DEFAULT '',
    "sirket_unvani" TEXT,
    "telefon" TEXT,
    "eposta" TEXT,
    "not_metni" TEXT,
    "yetkili_ad_soyad" TEXT NOT NULL DEFAULT '',
    "yetkili_telefon" TEXT NOT NULL DEFAULT '',
    "mudur_ad_soyad" TEXT NOT NULL DEFAULT '',
    "mudur_telefon" TEXT NOT NULL DEFAULT '',
    "muhasebe_ad_soyad" TEXT NOT NULL DEFAULT '',
    "muhasebe_telefon" TEXT NOT NULL DEFAULT '',
    "aktif_mi" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "muvekkil_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "muvekkil_tenant_id_aktif_mi_idx" ON "muvekkil"("tenant_id", "aktif_mi");

-- CreateIndex
CREATE INDEX "muvekkil_tenant_id_gorunen_ad_idx" ON "muvekkil"("tenant_id", "gorunen_ad");

-- AddForeignKey
ALTER TABLE "muvekkil" ADD CONSTRAINT "muvekkil_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muvekkil" ADD CONSTRAINT "muvekkil_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muvekkil" ADD CONSTRAINT "muvekkil_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
