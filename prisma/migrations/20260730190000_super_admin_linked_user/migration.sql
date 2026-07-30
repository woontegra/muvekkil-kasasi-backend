-- SuperAdmin ↔ Tenant User güvenli bağlantı (e-posta yetki vermez).
ALTER TABLE "super_admin"
  ADD COLUMN IF NOT EXISTS "linked_user_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "super_admin_linked_user_id_key"
  ON "super_admin"("linked_user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'super_admin_linked_user_id_fkey'
  ) THEN
    ALTER TABLE "super_admin"
      ADD CONSTRAINT "super_admin_linked_user_id_fkey"
      FOREIGN KEY ("linked_user_id") REFERENCES "user"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
