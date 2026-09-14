BEGIN;

-- TCMB / kur snapshot alanları — production'da uygulanmış
-- 20260911153000_multi_currency içeriğine sonradan eklenen kolonlar.
-- Yalnızca eksik enum/kolon ekler; veri silmez, rename yok.

-- KurKaynagi enum (yoksa oluştur)
DO $$ BEGIN
  CREATE TYPE "KurKaynagi" AS ENUM ('TCMB', 'MANUEL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Ofis kasa hareketi
ALTER TABLE "ofis_kasa_hareketi"
  ADD COLUMN IF NOT EXISTS "kur_kaynagi" "KurKaynagi",
  ADD COLUMN IF NOT EXISTS "tcmb_kur_tarihi" DATE,
  ADD COLUMN IF NOT EXISTS "tcmb_referans_kur" DECIMAL(24, 8);

-- Vekalet taksit ödeme
ALTER TABLE "vekalet_taksit_odeme"
  ADD COLUMN IF NOT EXISTS "kur_kaynagi" "KurKaynagi",
  ADD COLUMN IF NOT EXISTS "tcmb_kur_tarihi" DATE,
  ADD COLUMN IF NOT EXISTS "tcmb_referans_kur" DECIMAL(24, 8),
  ADD COLUMN IF NOT EXISTS "prim_try_matrahi" DECIMAL(14, 2);

-- İcra tahsilat ödeme
ALTER TABLE "icra_tahsilat_odeme"
  ADD COLUMN IF NOT EXISTS "kur_kaynagi" "KurKaynagi",
  ADD COLUMN IF NOT EXISTS "tcmb_kur_tarihi" DATE,
  ADD COLUMN IF NOT EXISTS "tcmb_referans_kur" DECIMAL(24, 8),
  ADD COLUMN IF NOT EXISTS "prim_try_matrahi" DECIMAL(14, 2);

-- Mevcut TRY ödemelerinde prim TL matrahı = kasaya giren tutar (geriye uyumluluk).
-- Yabancı para satırlarında kur snapshot olmadığı için NULL bırakılır; yeni tahsilatlarda doldurulur.
UPDATE "vekalet_taksit_odeme"
SET "prim_try_matrahi" = "kasa_tutari"
WHERE "prim_try_matrahi" IS NULL
  AND "odeme_para_birimi" = 'TRY';

UPDATE "icra_tahsilat_odeme"
SET "prim_try_matrahi" = "kasa_tutari"
WHERE "prim_try_matrahi" IS NULL
  AND "odeme_para_birimi" = 'TRY';

COMMIT;
