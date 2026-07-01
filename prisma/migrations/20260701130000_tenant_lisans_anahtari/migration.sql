-- SaaS lisans anahtarı (kiracı başına, merkezi lisans sunucusundan bağımsız).
ALTER TABLE "tenant" ADD COLUMN "lisans_anahtari" TEXT;

CREATE UNIQUE INDEX "tenant_lisans_anahtari_key" ON "tenant"("lisans_anahtari");
