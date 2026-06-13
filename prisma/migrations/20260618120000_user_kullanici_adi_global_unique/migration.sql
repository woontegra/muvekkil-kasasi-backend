-- DropIndex: tenant-scoped username unique → global unique on kullanici_adi
DROP INDEX IF EXISTS "user_tenant_id_kullanici_adi_key";

-- CreateIndex: kullanıcı adı sistem genelinde tekil
CREATE UNIQUE INDEX "user_kullanici_adi_key" ON "user"("kullanici_adi");
