-- CreateEnum
CREATE TYPE "TenantLicenseStatus" AS ENUM ('DEMO', 'AKTIF', 'SURESI_DOLDU', 'PASIF');

CREATE TYPE "SuperAdminRole" AS ENUM ('SUPER_ADMIN', 'DESTEK', 'FINANS');

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN "lisans_baslangic" TIMESTAMP(3),
ADD COLUMN "lisans_bitis" TIMESTAMP(3),
ADD COLUMN "lisans_durumu" "TenantLicenseStatus" NOT NULL DEFAULT 'AKTIF',
ADD COLUMN "demo_mu" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "demo_bitis" TIMESTAMP(3),
ADD COLUMN "son_odeme" TIMESTAMP(3),
ADD COLUMN "yillik_ucret" DECIMAL(14,2),
ADD COLUMN "lisans_notlari" TEXT;

-- CreateTable
CREATE TABLE "super_admin" (
    "id" TEXT NOT NULL,
    "ad_soyad" TEXT NOT NULL,
    "kullanici_adi" TEXT NOT NULL,
    "eposta" TEXT,
    "sifre_hash" TEXT NOT NULL,
    "rol" "SuperAdminRole" NOT NULL,
    "aktif_mi" BOOLEAN NOT NULL DEFAULT true,
    "son_giris_tarihi" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_admin_kullanici_adi_key" ON "super_admin"("kullanici_adi");

CREATE UNIQUE INDEX "super_admin_eposta_key" ON "super_admin"("eposta");

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_log_admin_id_created_at_idx" ON "admin_audit_log"("admin_id", "created_at");

CREATE INDEX "admin_audit_log_entity_type_entity_id_idx" ON "admin_audit_log"("entity_type", "entity_id");

ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "super_admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
