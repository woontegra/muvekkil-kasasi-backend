import 'dotenv/config'
import bcrypt from 'bcrypt'
import { PrismaClient, SuperAdminRole } from '@prisma/client'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const kullaniciAdi = process.env.ADMIN_SEED_USERNAME?.trim()
  const eposta = process.env.ADMIN_SEED_EMAIL?.trim()?.toLowerCase()
  const sifre = process.env.ADMIN_SEED_PASSWORD?.trim()

  if (!kullaniciAdi || !sifre) {
    console.error('[seed:admin] ADMIN_SEED_USERNAME ve ADMIN_SEED_PASSWORD zorunludur.')
    process.exit(1)
  }

  const existing = await prisma.superAdmin.findUnique({ where: { kullaniciAdi } })
  if (existing) {
    console.info('[seed:admin] Bu kullanıcı adıyla süper admin zaten var; atlanıyor.')
    return
  }

  const sifreHash = await bcrypt.hash(sifre, 12)
  await prisma.superAdmin.create({
    data: {
      adSoyad: process.env.ADMIN_SEED_AD_SOYAD?.trim() || 'Woontegra Admin',
      kullaniciAdi,
      eposta: eposta || null,
      sifreHash,
      rol: (process.env.ADMIN_SEED_ROLE as SuperAdminRole) || 'SUPER_ADMIN',
      aktifMi: true
    }
  })
  console.info('[seed:admin] Süper admin oluşturuldu:', kullaniciAdi)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
