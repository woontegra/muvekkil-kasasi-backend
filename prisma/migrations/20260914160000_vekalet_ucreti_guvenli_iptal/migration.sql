-- Additive: vekalet ücreti soft-iptal + dosya başına tek AKTIF unique + tahsilat/makbuz iptal damgası.
-- Finansal satır tutarları / kur snapshot’ları DEĞİŞMEZ.
-- Railway: yalnız açık onay ile prisma migrate deploy

CREATE TYPE "VekaletUcretiDurum" AS ENUM ('AKTIF', 'IPTAL');
CREATE TYPE "MakbuzDurumu" AS ENUM ('AKTIF', 'IPTAL');

ALTER TABLE "vekalet_ucreti" ADD COLUMN "durum" "VekaletUcretiDurum" NOT NULL DEFAULT 'AKTIF';
ALTER TABLE "vekalet_ucreti" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "vekalet_ucreti" ADD COLUMN "deleted_by_id" TEXT;
ALTER TABLE "vekalet_ucreti" ADD COLUMN "delete_reason" VARCHAR(1000);

ALTER TABLE "vekalet_taksit_odeme" ADD COLUMN "makbuz_durumu" "MakbuzDurumu" NOT NULL DEFAULT 'AKTIF';
ALTER TABLE "vekalet_taksit_odeme" ADD COLUMN "iptal_at" TIMESTAMP(3);
ALTER TABLE "vekalet_taksit_odeme" ADD COLUMN "iptal_by_id" TEXT;
ALTER TABLE "vekalet_taksit_odeme" ADD COLUMN "iptal_nedeni" VARCHAR(1000);

-- Eski global unique → yalnız aktif vekalet için partial unique
DROP INDEX IF EXISTS "vekalet_ucreti_dosya_id_key";
CREATE UNIQUE INDEX "vekalet_ucreti_aktif_dosya_uidx"
  ON "vekalet_ucreti"("dosya_id")
  WHERE "durum" = 'AKTIF';

CREATE INDEX "vekalet_ucreti_tenant_id_dosya_id_durum_idx"
  ON "vekalet_ucreti"("tenant_id", "dosya_id", "durum");

CREATE INDEX "vekalet_ucreti_dosya_id_durum_idx"
  ON "vekalet_ucreti"("dosya_id", "durum");

CREATE INDEX "vekalet_taksit_odeme_tenant_id_iptal_at_idx"
  ON "vekalet_taksit_odeme"("tenant_id", "iptal_at");

ALTER TABLE "vekalet_ucreti"
  ADD CONSTRAINT "vekalet_ucreti_deleted_by_id_fkey"
  FOREIGN KEY ("deleted_by_id") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vekalet_taksit_odeme"
  ADD CONSTRAINT "vekalet_taksit_odeme_iptal_by_id_fkey"
  FOREIGN KEY ("iptal_by_id") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
