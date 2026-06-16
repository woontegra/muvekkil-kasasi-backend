-- AlterEnum (idempotent)
ALTER TYPE "VekaletTaksitOdemeDurumu" ADD VALUE IF NOT EXISTS 'KISMI_ODENDI';

-- AlterEnum (idempotent)
ALTER TYPE "KasaHareketTipi" ADD VALUE IF NOT EXISTS 'VEKALET_TAHSILAT';

-- CreateTable (idempotent — önceki yarım deploy için)
CREATE TABLE IF NOT EXISTS "vekalet_taksit_odeme" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "muvekkil_id" TEXT NOT NULL,
    "dosya_id" TEXT NOT NULL,
    "taksit_id" TEXT NOT NULL,
    "odeme_tarihi" TIMESTAMP(3) NOT NULL,
    "tutar" DECIMAL(14,2) NOT NULL,
    "odeme_yontemi" "OdemeYontemi" NOT NULL,
    "aciklama" TEXT,
    "makbuz_no" TEXT NOT NULL,
    "smm_kesildi_mi" BOOLEAN NOT NULL DEFAULT false,
    "kasa_hareket_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vekalet_taksit_odeme_pkey" PRIMARY KEY ("id")
);

-- Eksik kolonlar (yarım kalmış eski tablo yapısı için)
ALTER TABLE "vekalet_taksit_odeme" ADD COLUMN IF NOT EXISTS "kasa_hareket_id" TEXT;
ALTER TABLE "vekalet_taksit_odeme" ADD COLUMN IF NOT EXISTS "smm_kesildi_mi" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vekalet_taksit_odeme" ADD COLUMN IF NOT EXISTS "aciklama" TEXT;
ALTER TABLE "vekalet_taksit_odeme" ADD COLUMN IF NOT EXISTS "odeme_yontemi" "OdemeYontemi";
ALTER TABLE "vekalet_taksit_odeme" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "vekalet_taksit_odeme_kasa_hareket_id_key" ON "vekalet_taksit_odeme"("kasa_hareket_id");

CREATE UNIQUE INDEX IF NOT EXISTS "vekalet_taksit_odeme_tenant_id_makbuz_no_key" ON "vekalet_taksit_odeme"("tenant_id", "makbuz_no");

CREATE INDEX IF NOT EXISTS "vekalet_taksit_odeme_tenant_id_taksit_id_idx" ON "vekalet_taksit_odeme"("tenant_id", "taksit_id");

CREATE INDEX IF NOT EXISTS "vekalet_taksit_odeme_tenant_id_dosya_id_idx" ON "vekalet_taksit_odeme"("tenant_id", "dosya_id");

CREATE INDEX IF NOT EXISTS "vekalet_taksit_odeme_tenant_id_smm_kesildi_mi_idx" ON "vekalet_taksit_odeme"("tenant_id", "smm_kesildi_mi");

-- AddForeignKey (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vekalet_taksit_odeme_tenant_id_fkey') THEN
    ALTER TABLE "vekalet_taksit_odeme" ADD CONSTRAINT "vekalet_taksit_odeme_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vekalet_taksit_odeme_muvekkil_id_fkey') THEN
    ALTER TABLE "vekalet_taksit_odeme" ADD CONSTRAINT "vekalet_taksit_odeme_muvekkil_id_fkey" FOREIGN KEY ("muvekkil_id") REFERENCES "muvekkil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vekalet_taksit_odeme_dosya_id_fkey') THEN
    ALTER TABLE "vekalet_taksit_odeme" ADD CONSTRAINT "vekalet_taksit_odeme_dosya_id_fkey" FOREIGN KEY ("dosya_id") REFERENCES "dosya"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vekalet_taksit_odeme_taksit_id_fkey') THEN
    ALTER TABLE "vekalet_taksit_odeme" ADD CONSTRAINT "vekalet_taksit_odeme_taksit_id_fkey" FOREIGN KEY ("taksit_id") REFERENCES "vekalet_taksiti"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vekalet_taksit_odeme_kasa_hareket_id_fkey') THEN
    ALTER TABLE "vekalet_taksit_odeme" ADD CONSTRAINT "vekalet_taksit_odeme_kasa_hareket_id_fkey" FOREIGN KEY ("kasa_hareket_id") REFERENCES "kasa_hareketi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vekalet_taksit_odeme_created_by_id_fkey') THEN
    ALTER TABLE "vekalet_taksit_odeme" ADD CONSTRAINT "vekalet_taksit_odeme_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Geriye uyumluluk: ödenmiş taksitler için tek ödeme satırı oluştur
INSERT INTO "vekalet_taksit_odeme" (
    "id",
    "tenant_id",
    "muvekkil_id",
    "dosya_id",
    "taksit_id",
    "odeme_tarihi",
    "tutar",
    "odeme_yontemi",
    "aciklama",
    "makbuz_no",
    "smm_kesildi_mi",
    "created_by_id",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid()::text,
    vt."tenant_id",
    vt."muvekkil_id",
    vt."dosya_id",
    vt."id",
    COALESCE(vt."odeme_tarihi", vt."updated_at"),
    vt."tutar",
    'NAKIT'::"OdemeYontemi",
    vt."aciklama",
    COALESCE(vt."makbuz_no", 'VEK-MIG-' || vt."id"),
    vt."smm_kesildi_mi",
    vt."created_by_id",
    vt."created_at",
    vt."updated_at"
FROM "vekalet_taksiti" vt
WHERE vt."odeme_durumu" = 'ODENDI'
  AND NOT EXISTS (
    SELECT 1 FROM "vekalet_taksit_odeme" o WHERE o."taksit_id" = vt."id"
  );
