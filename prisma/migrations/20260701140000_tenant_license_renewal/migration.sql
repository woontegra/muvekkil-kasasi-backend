-- Lisans / üyelik yenileme geçmişi (yeni tablo; mevcut tenant verisine dokunulmaz).

CREATE TYPE "LicenseRenewalSource" AS ENUM ('WOONTEGRA_WEBSITE', 'SUPER_ADMIN');

CREATE TABLE "tenant_license_renewal" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_order_id" TEXT,
    "external_customer_id" TEXT,
    "license_key" TEXT,
    "previous_end_date" TIMESTAMP(3) NOT NULL,
    "new_end_date" TIMESTAMP(3) NOT NULL,
    "renewal_days" INTEGER NOT NULL,
    "amount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "paid_at" TIMESTAMP(3),
    "source" "LicenseRenewalSource" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_license_renewal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_license_renewal_external_order_id_key" ON "tenant_license_renewal"("external_order_id");

CREATE INDEX "tenant_license_renewal_tenant_id_created_at_idx" ON "tenant_license_renewal"("tenant_id", "created_at");

ALTER TABLE "tenant_license_renewal" ADD CONSTRAINT "tenant_license_renewal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
