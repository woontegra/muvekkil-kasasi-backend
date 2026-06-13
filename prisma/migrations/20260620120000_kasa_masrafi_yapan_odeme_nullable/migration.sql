-- Masrafı yapan kişi; dosya kasası masraf girişi için.
ALTER TABLE "kasa_hareketi" ADD COLUMN "masrafi_yapan_kisi" TEXT;

-- Ödeme yöntemi artık zorunlu değil (eski kayıtlar korunur).
ALTER TABLE "kasa_hareketi" ALTER COLUMN "odeme_yontemi" DROP NOT NULL;
