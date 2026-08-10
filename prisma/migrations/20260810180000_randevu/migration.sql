-- CreateTable
CREATE TABLE "randevu" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "muvekkil_id" TEXT,
    "dosya_id" TEXT,
    "olusturan_user_id" TEXT NOT NULL,
    "sorumlu_user_id" TEXT,
    "baslik" TEXT NOT NULL,
    "baslangic_at" TIMESTAMP(3) NOT NULL,
    "bitis_at" TIMESTAMP(3) NOT NULL,
    "konum" TEXT,
    "aciklama" TEXT,
    "aktif_mi" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "randevu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "randevu_tenant_id_baslangic_at_idx" ON "randevu"("tenant_id", "baslangic_at");

-- CreateIndex
CREATE INDEX "randevu_sorumlu_user_id_baslangic_at_idx" ON "randevu"("sorumlu_user_id", "baslangic_at");

-- CreateIndex
CREATE INDEX "randevu_muvekkil_id_idx" ON "randevu"("muvekkil_id");

-- AddForeignKey
ALTER TABLE "randevu" ADD CONSTRAINT "randevu_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "randevu" ADD CONSTRAINT "randevu_muvekkil_id_fkey" FOREIGN KEY ("muvekkil_id") REFERENCES "muvekkil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "randevu" ADD CONSTRAINT "randevu_dosya_id_fkey" FOREIGN KEY ("dosya_id") REFERENCES "dosya"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "randevu" ADD CONSTRAINT "randevu_olusturan_user_id_fkey" FOREIGN KEY ("olusturan_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "randevu" ADD CONSTRAINT "randevu_sorumlu_user_id_fkey" FOREIGN KEY ("sorumlu_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
