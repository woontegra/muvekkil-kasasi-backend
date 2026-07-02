import { createApp } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import { logMailConfigOnStartup } from './mail/mail.service.js'

const app = createApp()

async function main(): Promise<void> {
  await prisma.$connect()
  logMailConfigOnStartup()
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.info(`API http://localhost:${env.PORT} (${env.NODE_ENV})`)
  })
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[bootstrap]', e)
  const msg = String(e?.message ?? e)
  if (e?.errorCode === 'P1001' || /Can't reach database server/i.test(msg)) {
    // eslint-disable-next-line no-console
    console.error(
      '[bootstrap] PostgreSQL bağlantısı kurulamadı. .env içindeki DATABASE_URL değerini kontrol edin.\n' +
        '  Yerel geliştirme: .env.example → localhost:5432\n' +
        '  Railway: Postgres servisinin çalıştığından ve public TCP proxy açık olduğundan emin olun.'
    )
  }
  process.exit(1)
})
