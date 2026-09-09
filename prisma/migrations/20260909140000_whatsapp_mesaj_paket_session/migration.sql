-- LicensePurchaseSession: WhatsApp mesaj paketi satın alma için package_id (additive).

ALTER TABLE "license_purchase_session"
  ADD COLUMN IF NOT EXISTS "package_id" TEXT;

CREATE INDEX IF NOT EXISTS "license_purchase_session_package_id_idx"
  ON "license_purchase_session"("package_id");
