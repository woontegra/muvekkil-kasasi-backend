-- Dosya kasası masraf girişi için Barokart ödeme yöntemi.
-- Yalnız enum değeri eklenir; mevcut kayıtlar değişmez.
ALTER TYPE "OdemeYontemi" ADD VALUE IF NOT EXISTS 'BAROKART';
