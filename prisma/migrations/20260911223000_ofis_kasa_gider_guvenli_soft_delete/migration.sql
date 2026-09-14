BEGIN;

-- Ofis Kasası GIDER güvenli soft-delete (additive).
-- Önceki 20260911220000 yalnız dosya kasa_hareketi içindi; Ofis Kasası ayrı tablo.

ALTER TABLE "ofis_kasa_hareketi"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleted_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "delete_reason" VARCHAR(1000);

DO $$ BEGIN
  ALTER TABLE "ofis_kasa_hareketi"
    ADD CONSTRAINT "ofis_kasa_hareketi_deleted_by_id_fkey"
    FOREIGN KEY ("deleted_by_id") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ofis_kasa_hareketi_tenant_id_deleted_at_idx"
  ON "ofis_kasa_hareketi"("tenant_id", "deleted_at");

COMMIT;
