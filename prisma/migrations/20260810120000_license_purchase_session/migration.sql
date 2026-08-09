-- CreateEnum
CREATE TYPE "LicensePurchaseSessionStatus" AS ENUM ('CREATED', 'BOUND', 'CONSUMED', 'EXPIRED');

-- CreateTable
CREATE TABLE "license_purchase_session" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'LICENSE_PURCHASE',
    "product_code" TEXT NOT NULL DEFAULT 'MUVEKKIL_KASA_SAAS',
    "status" "LicensePurchaseSessionStatus" NOT NULL DEFAULT 'CREATED',
    "bound_external_order_id" TEXT,
    "bound_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_purchase_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "license_purchase_session_token_hash_key" ON "license_purchase_session"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "license_purchase_session_bound_external_order_id_key" ON "license_purchase_session"("bound_external_order_id");

-- CreateIndex
CREATE INDEX "license_purchase_session_tenant_id_created_at_idx" ON "license_purchase_session"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "license_purchase_session_user_id_created_at_idx" ON "license_purchase_session"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "license_purchase_session" ADD CONSTRAINT "license_purchase_session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_purchase_session" ADD CONSTRAINT "license_purchase_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
