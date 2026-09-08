-- WhatsApp: sabit 10:00–20:00 ürün engeli kaldırıldı.
-- Yeni varsayılan öneri 09:00–20:00; mevcut tenant satırları değiştirilmez.
-- Sessiz saatler isteğe bağlı (randevu planlaması için).

ALTER TABLE "tahsilat_bildirim_ayar"
  ALTER COLUMN "izinli_saat_baslangic" SET DEFAULT 540;

ALTER TABLE "tahsilat_bildirim_ayar"
  ALTER COLUMN "izinli_saat_bitis" SET DEFAULT 1200;

ALTER TABLE "tahsilat_bildirim_ayar"
  ADD COLUMN IF NOT EXISTS "sessiz_saatleri_dikkate_al" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "tahsilat_bildirim_kurali"
  ALTER COLUMN "gonderim_saati_dk" SET DEFAULT 540;
