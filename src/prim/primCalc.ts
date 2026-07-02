export type PrimTierInput = {
  minTutar: number
  maxTutar: number | null
  oranYuzde: number
  siraNo: number
}

export type PrimKademeDetay = {
  minTutar: number
  maxTutar: number | null
  uygulananTutar: number
  oranYuzde: number
  primTutari: number
}

export type PrimHesapSonuc = {
  toplamPrim: number
  kademeler: PrimKademeDetay[]
}

function sortTiers(tiers: PrimTierInput[]): PrimTierInput[] {
  return [...tiers].sort((a, b) => a.siraNo - b.siraNo || a.minTutar - b.minTutar)
}

/** Toplam tahsilat hangi aralığa düşüyorsa o oran tüm tutara uygulanır. */
export function calcTotalBracketPremium(total: number, tiers: PrimTierInput[]): PrimHesapSonuc {
  const sorted = sortTiers(tiers)
  const tier = sorted.find((t) => {
    const min = t.minTutar
    const max = t.maxTutar
    if (total < min) return false
    if (max == null) return true
    return total <= max
  })

  if (!tier || total <= 0) {
    return { toplamPrim: 0, kademeler: [] }
  }

  const prim = total * (tier.oranYuzde / 100)
  return {
    toplamPrim: prim,
    kademeler: [
      {
        minTutar: tier.minTutar,
        maxTutar: tier.maxTutar,
        uygulananTutar: total,
        oranYuzde: tier.oranYuzde,
        primTutari: prim
      }
    ]
  }
}

/** Kademeli dilim: her aralığa düşen tutar ayrı oranla hesaplanır. */
export function calcProgressivePremium(total: number, tiers: PrimTierInput[]): PrimHesapSonuc {
  const sorted = sortTiers(tiers)
  const kademeler: PrimKademeDetay[] = []
  let toplamPrim = 0

  for (const tier of sorted) {
    if (total <= tier.minTutar) continue
    const upper = tier.maxTutar != null ? Math.min(total, tier.maxTutar) : total
    const amountInBracket = upper - tier.minTutar
    if (amountInBracket <= 0) continue
    const primTutari = amountInBracket * (tier.oranYuzde / 100)
    toplamPrim += primTutari
    kademeler.push({
      minTutar: tier.minTutar,
      maxTutar: tier.maxTutar,
      uygulananTutar: amountInBracket,
      oranYuzde: tier.oranYuzde,
      primTutari
    })
  }

  return { toplamPrim, kademeler }
}
