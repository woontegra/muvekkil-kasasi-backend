-- Merkezi lisans provisioning idempotency alanları
ALTER TABLE "tenant" ADD COLUMN "external_order_id" TEXT;
ALTER TABLE "tenant" ADD COLUMN "external_customer_id" TEXT;

CREATE UNIQUE INDEX "tenant_external_order_id_key" ON "tenant"("external_order_id");
