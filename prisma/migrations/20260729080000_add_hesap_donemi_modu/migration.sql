-- CreateEnum
CREATE TYPE "HesapDonemiModu" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN "hesap_donemi_modu" "HesapDonemiModu" NOT NULL DEFAULT 'MONTHLY';
