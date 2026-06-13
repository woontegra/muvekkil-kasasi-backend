-- CreateEnum
CREATE TYPE "ImportBatchSourceType" AS ENUM ('DESKTOP_SQLITE');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PREVIEWED', 'COMMITTED', 'FAILED');

-- CreateTable
CREATE TABLE "import_batch" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_type" "ImportBatchSourceType" NOT NULL,
    "source_fingerprint" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL,
    "row_counts" JSONB,
    "warnings" JSONB,
    "errors" JSONB,
    "committed_at" TIMESTAMP(3),
    "committed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batch_tenant_id_source_fingerprint_idx" ON "import_batch"("tenant_id", "source_fingerprint");

-- CreateIndex
CREATE INDEX "import_batch_tenant_id_status_idx" ON "import_batch"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_committed_by_id_fkey" FOREIGN KEY ("committed_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
