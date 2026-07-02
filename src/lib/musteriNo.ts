import type { Prisma, PrismaClient } from '@prisma/client'

type TxClient = Prisma.TransactionClient | PrismaClient

/**
 * Müşteriye gösterilen benzersiz sayısal müşteri numarası üretir.
 * - Sadece rakam
 * - 6 veya 7 haneli (ilk hane 0 olmaz)
 * - Tenant.musteriNo üzerinde benzersiz
 */
export function generateMusteriNoCandidate(): string {
  // 6 haneli: 100000-999999, 7 haneli: 1000000-9999999. %50 ihtimalle 7 hane.
  const sevenDigit = Math.random() < 0.5
  const min = sevenDigit ? 1_000_000 : 100_000
  const max = sevenDigit ? 9_999_999 : 999_999
  const n = Math.floor(min + Math.random() * (max - min + 1))
  return String(n)
}

export async function generateUniqueMusteriNo(tx: TxClient): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = generateMusteriNoCandidate()
    const clash = await tx.tenant.findUnique({ where: { musteriNo: candidate } })
    if (!clash) return candidate
  }
  throw new Error('Benzersiz müşteri numarası üretilemedi.')
}
