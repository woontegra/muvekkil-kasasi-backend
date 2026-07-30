-- Refresh oturum tabloları (HttpOnly cookie + hash).
-- Canlıya bu çalışmada uygulanmaz; manuel prisma migrate deploy ile alınmalıdır.

CREATE TABLE "refresh_session" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "label" VARCHAR(64),

    CONSTRAINT "refresh_session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_session_token_hash_key" ON "refresh_session"("token_hash");
CREATE INDEX "refresh_session_user_id_revoked_at_idx" ON "refresh_session"("user_id", "revoked_at");
CREATE INDEX "refresh_session_family_id_idx" ON "refresh_session"("family_id");
CREATE INDEX "refresh_session_tenant_id_idx" ON "refresh_session"("tenant_id");
CREATE INDEX "refresh_session_expires_at_idx" ON "refresh_session"("expires_at");

ALTER TABLE "refresh_session" ADD CONSTRAINT "refresh_session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_session" ADD CONSTRAINT "refresh_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "admin_refresh_session" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "label" VARCHAR(64),

    CONSTRAINT "admin_refresh_session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_refresh_session_token_hash_key" ON "admin_refresh_session"("token_hash");
CREATE INDEX "admin_refresh_session_admin_id_revoked_at_idx" ON "admin_refresh_session"("admin_id", "revoked_at");
CREATE INDEX "admin_refresh_session_family_id_idx" ON "admin_refresh_session"("family_id");
CREATE INDEX "admin_refresh_session_expires_at_idx" ON "admin_refresh_session"("expires_at");

ALTER TABLE "admin_refresh_session" ADD CONSTRAINT "admin_refresh_session_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "super_admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
