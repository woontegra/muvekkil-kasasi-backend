-- İlk giriş lisans aktivasyonu ve zorunlu şifre değişimi
ALTER TABLE "user" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN "license_activated_at" TIMESTAMP(3);

-- Mevcut kullanıcılar lisans doğrulamasından muaf (geriye dönük uyumluluk)
UPDATE "user"
SET "license_activated_at" = COALESCE("son_giris_tarihi", "created_at")
WHERE "license_activated_at" IS NULL;
