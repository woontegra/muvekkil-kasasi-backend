-- Vekalet tahsilatı Ofis Kasası bağlantısı (dosya kasasından ayrı)
ALTER TABLE "vekalet_taksit_odeme" ADD COLUMN "ofis_kasa_hareket_id" TEXT;

CREATE UNIQUE INDEX "vekalet_taksit_odeme_ofis_kasa_hareket_id_key" ON "vekalet_taksit_odeme"("ofis_kasa_hareket_id");

ALTER TABLE "vekalet_taksit_odeme" ADD CONSTRAINT "vekalet_taksit_odeme_ofis_kasa_hareket_id_fkey" FOREIGN KEY ("ofis_kasa_hareket_id") REFERENCES "ofis_kasa_hareketi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
