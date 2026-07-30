-- Onceki migration yeni enum degerlerini ekledi; commit sonrasi kullanilabilir.
UPDATE "whatsapp_baglanti"
SET "durum" = 'DISABLED'
WHERE "durum" IN ('BAGLI_DEGIL', 'ONAY_BEKLIYOR', 'HATA');
