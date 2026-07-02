import type { Prisma } from '@prisma/client'
import { OFIS_KASA_KAYNAK_ICRA_TAHSILAT, OFIS_KASA_KAYNAK_VEKALET_TAHSILATI } from '../ofisKasa/ofisKasa.service.js'

/** Ofis kasasındaki yalnızca manuel gelirler — vekalet/icra kaynaklı otomatik hareketler hariç. */
export function manuelOfisGelirKaynakWhere(): Prisma.OfisKasaHareketiWhereInput {
  return {
    OR: [
      { kaynakTipi: null },
      { kaynakTipi: '' },
      {
        kaynakTipi: {
          notIn: [OFIS_KASA_KAYNAK_ICRA_TAHSILAT, OFIS_KASA_KAYNAK_VEKALET_TAHSILATI]
        }
      }
    ]
  }
}

/** Yeni personel id veya eski userId (bagliUserId) ile eşleşen tahsilat kayıtları. */
export function tahsilatPersonelWhere(
  personelId: string,
  bagliUserId: string | null
): { OR: Prisma.KasaHareketiWhereInput[] } {
  const or: Prisma.KasaHareketiWhereInput[] = [{ tahsilatiYapanPersonelId: personelId }]
  if (bagliUserId) {
    or.push({ tahsilatiYapanPersonelId: null, tahsilatiYapanUserId: bagliUserId })
  }
  return { OR: or }
}

export function tahsilatVekaletPersonelWhere(
  personelId: string,
  bagliUserId: string | null
): { OR: Prisma.VekaletTaksitOdemeWhereInput[] } {
  const or: Prisma.VekaletTaksitOdemeWhereInput[] = [{ tahsilatiYapanPersonelId: personelId }]
  if (bagliUserId) {
    or.push({ tahsilatiYapanPersonelId: null, tahsilatiYapanUserId: bagliUserId })
  }
  return { OR: or }
}

export function tahsilatOfisPersonelWhere(
  personelId: string,
  bagliUserId: string | null
): { OR: Prisma.OfisKasaHareketiWhereInput[] } {
  const or: Prisma.OfisKasaHareketiWhereInput[] = [{ tahsilatiYapanPersonelId: personelId }]
  if (bagliUserId) {
    or.push({ tahsilatiYapanPersonelId: null, tahsilatiYapanUserId: bagliUserId })
  }
  return { OR: or }
}

export function tahsilatIcraPersonelWhere(
  personelId: string,
  bagliUserId: string | null
): { OR: Prisma.IcraTahsilatOdemeWhereInput[] } {
  const or: Prisma.IcraTahsilatOdemeWhereInput[] = [{ tahsilatiYapanPersonelId: personelId }]
  if (bagliUserId) {
    or.push({ tahsilatiYapanUserId: bagliUserId })
    or.push({ tahsilatiYapanPersonelId: null, tahsilatiYapanUserId: bagliUserId })
    // Eski kayıtlar: yalnızca createdById dolu
    or.push({
      tahsilatiYapanPersonelId: null,
      tahsilatiYapanUserId: null,
      createdById: bagliUserId
    })
  }
  return { OR: or }
}
