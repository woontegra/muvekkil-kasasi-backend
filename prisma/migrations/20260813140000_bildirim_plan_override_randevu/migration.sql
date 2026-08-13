-- CreateEnum
CREATE TYPE "BildirimPlanModu" AS ENUM ('VARSAYILAN', 'OZEL', 'KAPALI');

-- CreateEnum
CREATE TYPE "BildirimEntityType" AS ENUM ('VEKALET_TAKSITI', 'RANDEVU');

-- CreateEnum
CREATE TYPE "BildirimPlanKaynagi" AS ENUM ('VARSAYILAN', 'OZEL');

-- AlterTable
ALTER TABLE "tahsilat_bildirim_isi" ADD COLUMN "plan_kaynagi" "BildirimPlanKaynagi" NOT NULL DEFAULT 'VARSAYILAN';
ALTER TABLE "tahsilat_bildirim_isi" ADD COLUMN "plan_version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "bildirim_plan_entity" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_type" "BildirimEntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "mode" "BildirimPlanModu" NOT NULL DEFAULT 'VARSAYILAN',
    "kanal" "BildirimKanali" NOT NULL DEFAULT 'WHATSAPP',
    "plan_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bildirim_plan_entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bildirim_plan_kural" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_entity_id" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "aktif_mi" BOOLEAN NOT NULL DEFAULT true,
    "gun_offset" INTEGER NOT NULL DEFAULT 0,
    "offset_dk" INTEGER,
    "gonderim_saati_dk" INTEGER NOT NULL DEFAULT 600,
    "meta_sablon_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bildirim_plan_kural_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "randevu_bildirim_ayar" (
    "tenant_id" TEXT NOT NULL,
    "otomasyon_aktif" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "randevu_bildirim_ayar_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "randevu_bildirim_varsayilan_kural" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "offset_dk" INTEGER NOT NULL,
    "aktif_mi" BOOLEAN NOT NULL DEFAULT false,
    "meta_sablon_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "randevu_bildirim_varsayilan_kural_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "randevu_bildirim_isi" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "randevu_id" TEXT NOT NULL,
    "muvekkil_id" TEXT NOT NULL,
    "kanal" "BildirimKanali" NOT NULL DEFAULT 'WHATSAPP',
    "provider" "BildirimProvider",
    "offset_dk" INTEGER NOT NULL,
    "planlanan_at" TIMESTAMP(3) NOT NULL,
    "durum" "BildirimIsDurumu" NOT NULL DEFAULT 'PLANLANDI',
    "plan_kaynagi" "BildirimPlanKaynagi" NOT NULL DEFAULT 'VARSAYILAN',
    "plan_version" INTEGER NOT NULL DEFAULT 1,
    "iptal_nedeni" TEXT,
    "atlama_nedeni" TEXT,
    "hata_ozeti" TEXT,
    "deneme_sayisi" INTEGER NOT NULL DEFAULT 0,
    "telefon_maskeli" TEXT,
    "provider_message_id" TEXT,
    "meta_sablon_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "randevu_bildirim_isi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bildirim_plan_entity_tenant_id_entity_type_entity_id_kanal_key" ON "bildirim_plan_entity"("tenant_id", "entity_type", "entity_id", "kanal");

-- CreateIndex
CREATE INDEX "bildirim_plan_entity_tenant_id_entity_type_idx" ON "bildirim_plan_entity"("tenant_id", "entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "bildirim_plan_kural_plan_entity_id_rule_key_key" ON "bildirim_plan_kural"("plan_entity_id", "rule_key");

-- CreateIndex
CREATE INDEX "bildirim_plan_kural_tenant_id_idx" ON "bildirim_plan_kural"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "randevu_bildirim_varsayilan_kural_tenant_id_offset_dk_key" ON "randevu_bildirim_varsayilan_kural"("tenant_id", "offset_dk");

-- CreateIndex
CREATE UNIQUE INDEX "randevu_bildirim_isi_idempotency_key_key" ON "randevu_bildirim_isi"("idempotency_key");

-- CreateIndex
CREATE INDEX "randevu_bildirim_isi_tenant_id_durum_planlanan_at_idx" ON "randevu_bildirim_isi"("tenant_id", "durum", "planlanan_at");

-- CreateIndex
CREATE INDEX "randevu_bildirim_isi_tenant_id_randevu_id_durum_idx" ON "randevu_bildirim_isi"("tenant_id", "randevu_id", "durum");

-- AddForeignKey
ALTER TABLE "bildirim_plan_entity" ADD CONSTRAINT "bildirim_plan_entity_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bildirim_plan_kural" ADD CONSTRAINT "bildirim_plan_kural_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bildirim_plan_kural" ADD CONSTRAINT "bildirim_plan_kural_plan_entity_id_fkey" FOREIGN KEY ("plan_entity_id") REFERENCES "bildirim_plan_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bildirim_plan_kural" ADD CONSTRAINT "bildirim_plan_kural_meta_sablon_id_fkey" FOREIGN KEY ("meta_sablon_id") REFERENCES "whatsapp_meta_sablon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "randevu_bildirim_ayar" ADD CONSTRAINT "randevu_bildirim_ayar_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "randevu_bildirim_varsayilan_kural" ADD CONSTRAINT "randevu_bildirim_varsayilan_kural_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "randevu_bildirim_varsayilan_kural" ADD CONSTRAINT "randevu_bildirim_varsayilan_kural_meta_sablon_id_fkey" FOREIGN KEY ("meta_sablon_id") REFERENCES "whatsapp_meta_sablon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "randevu_bildirim_isi" ADD CONSTRAINT "randevu_bildirim_isi_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "randevu_bildirim_isi" ADD CONSTRAINT "randevu_bildirim_isi_randevu_id_fkey" FOREIGN KEY ("randevu_id") REFERENCES "randevu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "randevu_bildirim_isi" ADD CONSTRAINT "randevu_bildirim_isi_muvekkil_id_fkey" FOREIGN KEY ("muvekkil_id") REFERENCES "muvekkil"("id") ON DELETE CASCADE ON UPDATE CASCADE;
