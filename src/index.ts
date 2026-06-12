import { createApp } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'

const app = createApp()

async function main(): Promise<void> {
  await prisma.$connect()
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
