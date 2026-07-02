-- Müşteriye gösterilen benzersiz sayısal müşteri numarası (6-7 hane).
ALTER TABLE "tenant" ADD COLUMN "musteri_no" TEXT;

CREATE UNIQUE INDEX "tenant_musteri_no_key" ON "tenant"("musteri_no");
