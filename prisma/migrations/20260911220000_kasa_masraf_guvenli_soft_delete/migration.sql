BEGIN;

-- Dosya masrafı güvenli soft-delete alanları.
-- Production'a bu oturumda uygulanmaz; yerel/prod için ayrı onay sonrası migrate.

ALTER TABLE "kasa_hareketi"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleted_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "delete_reason" VARCHAR(1000);

DO $$ BEGIN
  ALTER TABLE "kasa_hareketi"
    ADD CONSTRAINT "kasa_hareketi_deleted_by_id_fkey"
    FOREIGN KEY ("deleted_by_id") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "kasa_hareketi_tenant_id_dosya_id_deleted_at_idx"
  ON "kasa_hareketi"("tenant_id", "dosya_id", "deleted_at");

COMMIT;
