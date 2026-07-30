-- Taksit düzeyinde otomatik hatırlatma anahtarı (varsayılan açık).
-- Geriye uyumlu: mevcut satırlar true kabul edilir; müvekkil izni varsayılan kapalı olduğundan
-- bu kolon tek başına gerçek mesaj tetiklemez.

ALTER TABLE "vekalet_taksiti"
  ADD COLUMN IF NOT EXISTS "otomatik_bildirim_aktif" BOOLEAN NOT NULL DEFAULT true;
