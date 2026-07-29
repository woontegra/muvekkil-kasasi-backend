-- Otomatik tahsilat bildirim altyapısı (Faz 1).
-- DO NOT auto-apply from agent; use `npx prisma migrate deploy` manually when ready.

-- Enums
DO $$ BEGIN
  CREATE TYPE "BildirimKanali" AS ENUM ('WHATSAPP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BildirimKuralTuru" AS ENUM ('VADEDEN_ONCE', 'VADE_GUNU', 'VADE_SONRASI');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BildirimIsDurumu" AS ENUM (
    'PLANLANDI',
    'KUYRUKTA',
    'SIMULASYON_TAMAMLANDI',
    'GONDERILDI',
    'TESLIM_EDILDI',
    'OKUNDU',
    'BASARISIZ',
    'IPTAL_EDILDI',
    'ATLANDI'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "WhatsAppBaglantiDurumu" AS ENUM ('BAGLI_DEGIL', 'ONAY_BEKLIYOR', 'BAGLI', 'HATA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Muvekkil / Dosya flags
ALTER TABLE "muvekkil" ADD COLUMN IF NOT EXISTS "otomatik_bildirim_izni" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "dosya" ADD COLUMN IF NOT EXISTS "otomatik_bildirim_aktif" BOOLEAN NOT NULL DEFAULT true;

-- Ayar
CREATE TABLE IF NOT EXISTS "tahsilat_bildirim_ayar" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "otomasyon_aktif" BOOLEAN NOT NULL DEFAULT false,
    "test_modu" BOOLEAN NOT NULL DEFAULT true,
    "izinli_saat_baslangic" INTEGER NOT NULL DEFAULT 600,
    "izinli_saat_bitis" INTEGER NOT NULL DEFAULT 1200,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tahsilat_bildirim_ayar_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tahsilat_bildirim_ayar_tenant_id_key" ON "tahsilat_bildirim_ayar"("tenant_id");

-- Kural
CREATE TABLE IF NOT EXISTS "tahsilat_bildirim_kurali" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kural_turu" "BildirimKuralTuru" NOT NULL,
    "aktif_mi" BOOLEAN NOT NULL DEFAULT false,
    "gun_offset" INTEGER NOT NULL,
    "gonderim_saati_dk" INTEGER NOT NULL DEFAULT 600,
    "kanal" "BildirimKanali" NOT NULL DEFAULT 'WHATSAPP',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tahsilat_bildirim_kurali_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tahsilat_bildirim_kurali_tenant_id_kural_turu_kanal_key"
  ON "tahsilat_bildirim_kurali"("tenant_id", "kural_turu", "kanal");
CREATE INDEX IF NOT EXISTS "tahsilat_bildirim_kurali_tenant_id_aktif_mi_idx"
  ON "tahsilat_bildirim_kurali"("tenant_id", "aktif_mi");

-- Şablon
CREATE TABLE IF NOT EXISTS "tahsilat_bildirim_sablonu" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kural_turu" "BildirimKuralTuru" NOT NULL,
    "kanal" "BildirimKanali" NOT NULL DEFAULT 'WHATSAPP',
    "metin" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tahsilat_bildirim_sablonu_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tahsilat_bildirim_sablonu_tenant_id_kural_turu_kanal_key"
  ON "tahsilat_bildirim_sablonu"("tenant_id", "kural_turu", "kanal");

-- İş
CREATE TABLE IF NOT EXISTS "tahsilat_bildirim_isi" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "muvekkil_id" TEXT NOT NULL,
    "dosya_id" TEXT NOT NULL,
    "taksit_id" TEXT NOT NULL,
    "kanal" "BildirimKanali" NOT NULL DEFAULT 'WHATSAPP',
    "kural_turu" "BildirimKuralTuru" NOT NULL,
    "planlanan_at" TIMESTAMP(3) NOT NULL,
    "kalan_tutar_snapshot" DECIMAL(14,2) NOT NULL,
    "durum" "BildirimIsDurumu" NOT NULL DEFAULT 'PLANLANDI',
    "iptal_nedeni" TEXT,
    "atlama_nedeni" TEXT,
    "hata_ozeti" TEXT,
    "deneme_sayisi" INTEGER NOT NULL DEFAULT 0,
    "son_deneme_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tahsilat_bildirim_isi_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tahsilat_bildirim_isi_idempotency_key_key"
  ON "tahsilat_bildirim_isi"("idempotency_key");
CREATE INDEX IF NOT EXISTS "tahsilat_bildirim_isi_tenant_id_durum_planlanan_at_idx"
  ON "tahsilat_bildirim_isi"("tenant_id", "durum", "planlanan_at");
CREATE INDEX IF NOT EXISTS "tahsilat_bildirim_isi_tenant_id_taksit_id_durum_idx"
  ON "tahsilat_bildirim_isi"("tenant_id", "taksit_id", "durum");
CREATE INDEX IF NOT EXISTS "tahsilat_bildirim_isi_durum_planlanan_at_idx"
  ON "tahsilat_bildirim_isi"("durum", "planlanan_at");

-- Deneme
CREATE TABLE IF NOT EXISTS "tahsilat_bildirim_deneme" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "is_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "basarili_mi" BOOLEAN NOT NULL,
    "telefon_maskeli" TEXT,
    "sablon_ozeti" TEXT,
    "mesaj_ozeti" TEXT,
    "sonuc_kodu" TEXT,
    "sonuc_mesaji" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tahsilat_bildirim_deneme_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tahsilat_bildirim_deneme_tenant_id_created_at_idx"
  ON "tahsilat_bildirim_deneme"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "tahsilat_bildirim_deneme_is_id_created_at_idx"
  ON "tahsilat_bildirim_deneme"("is_id", "created_at");

-- WhatsApp bağlantı
CREATE TABLE IF NOT EXISTS "whatsapp_baglanti" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "durum" "WhatsAppBaglantiDurumu" NOT NULL DEFAULT 'BAGLI_DEGIL',
    "access_token_encrypted" TEXT,
    "waba_id_masked" TEXT,
    "phone_number_id_masked" TEXT,
    "son_hata_ozeti" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_baglanti_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_baglanti_tenant_id_key" ON "whatsapp_baglanti"("tenant_id");

-- Foreign keys (idempotent via exception)
DO $$ BEGIN
  ALTER TABLE "tahsilat_bildirim_ayar" ADD CONSTRAINT "tahsilat_bildirim_ayar_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "tahsilat_bildirim_kurali" ADD CONSTRAINT "tahsilat_bildirim_kurali_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "tahsilat_bildirim_sablonu" ADD CONSTRAINT "tahsilat_bildirim_sablonu_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "tahsilat_bildirim_isi" ADD CONSTRAINT "tahsilat_bildirim_isi_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "tahsilat_bildirim_isi" ADD CONSTRAINT "tahsilat_bildirim_isi_muvekkil_id_fkey"
    FOREIGN KEY ("muvekkil_id") REFERENCES "muvekkil"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "tahsilat_bildirim_isi" ADD CONSTRAINT "tahsilat_bildirim_isi_dosya_id_fkey"
    FOREIGN KEY ("dosya_id") REFERENCES "dosya"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "tahsilat_bildirim_isi" ADD CONSTRAINT "tahsilat_bildirim_isi_taksit_id_fkey"
    FOREIGN KEY ("taksit_id") REFERENCES "vekalet_taksiti"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "tahsilat_bildirim_deneme" ADD CONSTRAINT "tahsilat_bildirim_deneme_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "tahsilat_bildirim_deneme" ADD CONSTRAINT "tahsilat_bildirim_deneme_is_id_fkey"
    FOREIGN KEY ("is_id") REFERENCES "tahsilat_bildirim_isi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_baglanti" ADD CONSTRAINT "whatsapp_baglanti_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
