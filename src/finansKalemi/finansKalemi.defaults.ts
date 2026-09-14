import { FinansKalemTuru } from '@prisma/client'

export type FinansKalemSeed = {
  tur: FinansKalemTuru
  ad: string
  kod?: string
  sistemMi: boolean
  sira: number
}

/** Büyük/küçük harf ve kenar boşluklarını yok sayan normalize (duplicate engeli). */
export function normalizeFinansKalemAd(ad: string): string {
  return ad.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR')
}

/** Sistem tarafından yazılan kilitli kalemler — kullanıcı sil/ad değiştiremez. */
export const SISTEM_FINANS_KALEMLERI: FinansKalemSeed[] = [
  { tur: FinansKalemTuru.GELIR, ad: 'Vekalet Ücreti Tahsilatı', kod: 'VEKALET_TAHSILATI', sistemMi: true, sira: 0 },
  { tur: FinansKalemTuru.GELIR, ad: 'Karşı Taraf Vekalet Ücreti', kod: 'KARSI_TARAF_VEKALET', sistemMi: true, sira: 1 },
  { tur: FinansKalemTuru.GELIR, ad: 'İcra Vekalet Ücreti', kod: 'ICRA_VEKALET', sistemMi: true, sira: 2 },
  { tur: FinansKalemTuru.GELIR, ad: 'Düzeltme', kod: 'DUZELTME', sistemMi: true, sira: 3 },
  { tur: FinansKalemTuru.GELIR, ad: 'Döviz dönüşümü', kod: 'DOVIZ_DONUSUM', sistemMi: true, sira: 4 }
]

/** Manuel ofis gelir formu varsayılanları (sistem tahsilat kalemleri hariç). */
export const VARSAYILAN_GELIR_KALEMLERI: string[] = [
  'Vekalet ücreti dışı gelir',
  'Danışmanlık geliri',
  'İade alınan ödeme',
  'Diğer gelir'
]

/** Ofis gider + dosya masraf birleşik varsayılan gider kalemleri. */
export const VARSAYILAN_GIDER_KALEMLERI: string[] = [
  'Ofis kirası',
  'Personel maaşı',
  'SGK ödemesi',
  'Vergi ödemesi',
  'Stopaj',
  'Muhasebe ücreti',
  'Elektrik',
  'Su',
  'İnternet / telefon',
  'Kırtasiye',
  'Ulaşım',
  'Yemek',
  'Temizlik',
  'Demirbaş',
  'Yazılım / abonelik',
  'Banka masrafı',
  'Diğer gider',
  'Harç',
  'Gider Avansı',
  'Bilirkişi Ücreti',
  'Keşif-İcra, Haciz vs.',
  'Yol-Yemek vs.',
  'Diğer'
]

export function buildTenantFinansKalemSeeds(): FinansKalemSeed[] {
  const out: FinansKalemSeed[] = [...SISTEM_FINANS_KALEMLERI]
  let sira = 10
  for (const ad of VARSAYILAN_GELIR_KALEMLERI) {
    out.push({ tur: FinansKalemTuru.GELIR, ad, sistemMi: false, sira })
    sira += 1
  }
  sira = 10
  for (const ad of VARSAYILAN_GIDER_KALEMLERI) {
    out.push({ tur: FinansKalemTuru.GIDER, ad, sistemMi: false, sira })
    sira += 1
  }
  return out
}

export function isDigerGelirKalemAd(ad: string): boolean {
  return normalizeFinansKalemAd(ad) === normalizeFinansKalemAd('Diğer gelir')
}

export function isDigerGiderKalemAd(ad: string): boolean {
  const n = normalizeFinansKalemAd(ad)
  return (
    n === normalizeFinansKalemAd('Diğer gider') ||
    n === normalizeFinansKalemAd('Diğer') ||
    n === normalizeFinansKalemAd('Diğer masraf')
  )
}
