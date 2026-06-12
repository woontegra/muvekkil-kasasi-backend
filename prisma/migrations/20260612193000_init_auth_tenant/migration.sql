-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('BURO_SAHIBI', 'AVUKAT_YONETICI', 'KATIP_PERSONEL');

-- CreateTable
CREATE TABLE "tenant" (
    "id" TEXT NOT NULL,
    "buro_adi" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "telefon" TEXT,
    "eposta" TEXT,
    "adres" TEXT,
    "vergi_no" TEXT,
    "vergi_dairesi" TEXT,
    "aktif_mi" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ad_soyad" TEXT NOT NULL,
    "kullanici_adi" TEXT NOT NULL,
    "eposta" TEXT,
    "telefon" TEXT,
    "sifre_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "aktif_mi" BOOLEAN NOT NULL DEFAULT true,
    "son_giris_tarihi" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "meta" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE INDEX "user_tenant_id_idx" ON "user"("tenant_id");

-- CreateIndex
CREATE INDEX "user_eposta_idx" ON "user"("eposta");

-- CreateIndex
CREATE UNIQUE INDEX "user_tenant_id_kullanici_adi_key" ON "user"("tenant_id", "kullanici_adi");

-- CreateIndex
CREATE UNIQUE INDEX "user_tenant_id_eposta_key" ON "user"("tenant_id", "eposta");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
