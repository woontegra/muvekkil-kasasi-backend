-- HAZIR AMA UYGULANMAMIŞ TEMİZLİK MIGRATION'I
-- Müvekkil ekstre güvenli paylaşım tablosunu kaldırır.
--
-- Durum (2026-07-29):
-- - 20260729210000_add_muvekkil_ekstre_paylasim canlı Railway DB'de uygulanmış görünüyor
--   (`prisma migrate status` → 24 migration, schema up to date).
-- - Bu drop migration bilinçli `prisma migrate deploy` ile uygulanmalıdır.
-- - Agent tarafından otomatik uygulanmamıştır.
--
-- Uygulama komutu (manuel):
--   npx prisma migrate deploy

DROP TABLE IF EXISTS "muvekkil_ekstre_paylasim";
