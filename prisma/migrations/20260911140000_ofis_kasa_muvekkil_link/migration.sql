-- Ofis kasası GELIR hareketlerine isteğe bağlı müvekkil bağlama.
-- Mevcut kayıtlar muvekkil_id = NULL kalır. Para birimi kolonu bu pakette yok.

ALTER TABLE "ofis_kasa_hareketi"
  ADD COLUMN IF NOT EXISTS "muvekkil_id" TEXT,
  ADD COLUMN IF NOT EXISTS "muvekkil_adi_snapshot" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ofis_kasa_hareketi_muvekkil_id_fkey'
  ) THEN
    ALTER TABLE "ofis_kasa_hareketi"
      ADD CONSTRAINT "ofis_kasa_hareketi_muvekkil_id_fkey"
      FOREIGN KEY ("muvekkil_id") REFERENCES "muvekkil"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ofis_kasa_hareketi_tenant_id_muvekkil_id_idx"
  ON "ofis_kasa_hareketi"("tenant_id", "muvekkil_id");
