-- CreateEnum
CREATE TYPE "LicenseExpiryReminderType" AS ENUM ('D30', 'D7', 'D1');

-- CreateEnum
CREATE TYPE "LicenseExpiryReminderStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "license_expiry_reminder" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "license_end_date" TIMESTAMP(3) NOT NULL,
    "reminder_type" "LicenseExpiryReminderType" NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "LicenseExpiryReminderStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "error" TEXT,
    "purchase_session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "license_expiry_reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "license_expiry_reminder_status_created_at_idx" ON "license_expiry_reminder"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "license_expiry_reminder_tenant_id_license_end_date_reminder_type_key" ON "license_expiry_reminder"("tenant_id", "license_end_date", "reminder_type");

-- AddForeignKey
ALTER TABLE "license_expiry_reminder" ADD CONSTRAINT "license_expiry_reminder_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
