import { prisma } from '../lib/prisma.js'
import { generateTemporaryPassword } from '../lib/temporaryPassword.js'
import { hashPassword } from '../admin/adminAuth.service.js'

/** Owner geçici şifresini üretir, hash kaydeder; düz metin yalnızca mail için döner. */
export async function issueOwnerTemporaryPassword(userId: string): Promise<string> {
  const geciciSifre = generateTemporaryPassword()
  const sifreHash = await hashPassword(geciciSifre)
  await prisma.user.update({
    where: { id: userId },
    data: { sifreHash },
  })
  return geciciSifre
}
