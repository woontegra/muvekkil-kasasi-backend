/**
 * Eski tenant kayıtlarında boş kalan lisans tarihlerini doldurur.
 * Çalıştır: npm run backfill:tenant-licenses
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function addMonths(d: Date, months: number): Date {
  const x = new Date(d)
  x.setMonth(x.getMonth() + months)
  return x
}

async function main(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: {
      OR: [{ lisansBaslangicTarihi: null }, { lisansBitisTarihi: null }]
    },
    select: {
      id: true,
      buroAdi: true,
      aktifMi: true,
      lisansDurumu: true,
      lisansBaslangicTarihi: true,
      lisansBitisTarihi: true,
      createdAt: true
    }
  })

  let updated = 0
  for (const t of tenants) {
    const needsBas = t.lisansBaslangicTarihi == null
    const needsBitis = t.lisansBitisTarihi == null
    if (!needsBas && !needsBitis) continue

    const baslangic = t.lisansBaslangicTarihi ?? t.createdAt
    const bitis = t.lisansBitisTarihi ?? addMonths(baslangic, 12)

    const data: {
      lisansBaslangicTarihi?: Date
      lisansBitisTarihi?: Date
      lisansDurumu?: 'PASIF'
    } = {}

    if (needsBas) data.lisansBaslangicTarihi = baslangic
    if (needsBitis) data.lisansBitisTarihi = bitis

    if (!t.aktifMi && t.lisansDurumu !== 'PASIF') {
      data.lisansDurumu = 'PASIF'
    }

    await prisma.tenant.update({
      where: { id: t.id },
      data
    })
    updated += 1
    console.info(`[backfill] Güncellendi: ${t.buroAdi} (${t.id})`)
  }

  console.info(`[backfill] Tamamlandı. Güncellenen tenant sayısı: ${updated} (aday: ${tenants.length})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())
