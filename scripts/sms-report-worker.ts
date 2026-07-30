import { processSmsReportWorker } from '../src/tahsilatBildirim/smsReportWorker.service.js'

async function main() {
  const limit = Number(process.env.SMS_REPORT_LIMIT ?? 100)
  const out = await processSmsReportWorker(limit)
  console.log(
    JSON.stringify({
      ok: true,
      checked: out.checked,
      delivered: out.delivered,
      failed: out.failed,
      waiting: out.waiting
    })
  )
}

main().catch((err) => {
  console.error('[sms-report-worker] failed', err instanceof Error ? err.message : err)
  process.exit(1)
})
