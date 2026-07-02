import type { IcraTahsilatAlacakDurum, IcraTahsilatAlacakTuru } from '@prisma/client'

export const ICRA_ALACAK_TURU_LABEL: Record<IcraTahsilatAlacakTuru, string> = {
  KARSI_TARAF_VEKALET: 'Karşı Taraf Vekalet Ücreti',
  ICRA_VEKALET: 'İcra Vekalet Ücreti'
}

export const ICRA_ALACAK_DURUM_LABEL: Record<IcraTahsilatAlacakDurum, string> = {
  ACIK: 'Açık',
  KISMI_ODENDI: 'Kısmi ödendi',
  ODENDI: 'Ödendi',
  GECIKTI: 'Gecikti',
  IPTAL: 'İptal'
}

export function icraAlacakTuruToOfisKategori(tur: IcraTahsilatAlacakTuru): string {
  return ICRA_ALACAK_TURU_LABEL[tur]
}
