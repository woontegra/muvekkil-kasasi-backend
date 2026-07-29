-- Müvekkil ekstre güvenli paylaşım bağlantıları (token hash; düz metin token saklanmaz).
CREATE TABLE "muvekkil_ekstre_paylasim" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dosya_id" TEXT NOT NULL,
    "muvekkil_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "belge_ref" TEXT NOT NULL,
    "itibariyle_tarih" TIMESTAMP(3) NOT NULL,
    "sure_gun" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "muvekkil_ekstre_paylasim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "muvekkil_ekstre_paylasim_token_hash_key" ON "muvekkil_ekstre_paylasim"("token_hash");
CREATE INDEX "muvekkil_ekstre_paylasim_tenant_id_dosya_id_created_at_idx" ON "muvekkil_ekstre_paylasim"("tenant_id", "dosya_id", "created_at");
CREATE INDEX "muvekkil_ekstre_paylasim_tenant_id_expires_at_idx" ON "muvekkil_ekstre_paylasim"("tenant_id", "expires_at");

ALTER TABLE "muvekkil_ekstre_paylasim" ADD CONSTRAINT "muvekkil_ekstre_paylasim_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "muvekkil_ekstre_paylasim" ADD CONSTRAINT "muvekkil_ekstre_paylasim_dosya_id_fkey" FOREIGN KEY ("dosya_id") REFERENCES "dosya"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "muvekkil_ekstre_paylasim" ADD CONSTRAINT "muvekkil_ekstre_paylasim_muvekkil_id_fkey" FOREIGN KEY ("muvekkil_id") REFERENCES "muvekkil"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "muvekkil_ekstre_paylasim" ADD CONSTRAINT "muvekkil_ekstre_paylasim_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
