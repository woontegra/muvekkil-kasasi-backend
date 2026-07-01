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
  process.exit(1)
})
