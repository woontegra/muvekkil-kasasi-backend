/**
 * WhatsApp tahsilat otomasyonu — tek sefer planla + işle, sonra çık.
 *
 * Çalıştır: npm run bildirim:automation
 * Dry-run:  npm run bildirim:automation -- --dry-run
 *   → Salt okunur önizleme: DB yazmaz, Meta çağırmaz, processDueJobs çalıştırmaz.
 *
 * Railway cron (önerilen): her 5 dakika
 * Start: npm run bildirim:automation
 *
 * 10:00–20:00 TR penceresi worker içinde korunur.
 * IdempotencyKey + job lock mevcut planner/worker yapısından gelir.
 * Lisans cron’una dokunmaz.
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { env } from '../src/config/env.js'
import { planJobsForAllTenants } from '../src/tahsilatBildirim/planner.service.js'
import { previewPlanJobsForAllTenants } from '../src/tahsilatBildirim/plannerPreview.service.js'
import { processDueJobs } from '../src/tahsilatBildirim/worker.service.js'

function isDryRun(): boolean {
  return process.argv.includes('--dry-run') || process.env.BILDIRIM_AUTOMATION_DRY_RUN === 'true'
}

async function main(): Promise<void> {
  const dryRun = isDryRun()
  await prisma.$connect()

  if (dryRun) {
    // Kesin güvence: planJobs / processDueJobs çağrılmaz → create/update/Meta yok.
    const preview = await previewPlanJobsForAllTenants()
    const focus = preview.results.filter((r) => {
      const n = r.buroAdi.toLowerCase()
      return (
        n.includes('woontegra') ||
        n.includes('e2e') ||
        n.includes('e2e-test') ||
        n.includes('e2e_test')
      )
    })
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        ok: true,
        command: 'bildirim:automation',
        dryRun: true,
        writesDb: false,
        callsMeta: false,
        automationEnabled: preview.automationEnabled,
        cloudApiEnabled: preview.cloudApiEnabled,
        todayYmd: preview.todayYmd,
        minutesNowTr: preview.minutesNowTr,
        totals: preview.totals,
        tenants: preview.tenants,
        focusTenants: focus,
        allTenantsSummary: preview.results.map((r) => ({
          buroAdi: r.buroAdi,
          skipped: r.skipped,
          reason: r.reason,
          otomasyonAktif: r.otomasyonAktif,
          cloudReady: r.cloudReady,
          adayTaksitSayisi: r.adayTaksitSayisi,
          uygunTaksitSayisi: r.uygunTaksitSayisi,
          bugunPlanlanacakIs: r.bugunPlanlanacakIs,
          blockerSummary: r.blockerSummary,
          wouldPlanCount: r.wouldPlan.length,
          wouldPlanNew: r.wouldPlan.filter((j) => !j.alreadyExists).length,
          wouldPlanExisting: r.wouldPlan.filter((j) => j.alreadyExists).length
        }))
      })
    )
    return
  }

  const plan = await planJobsForAllTenants()
  const worker = await processDueJobs({
    limit: 100,
    workerId: `automation-${process.pid}`
  })

  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      ok: true,
      command: 'bildirim:automation',
      dryRun: false,
      automationEnabled: env.WHATSAPP_AUTOMATION_ENABLED === true,
      cloudApiEnabled: env.WHATSAPP_CLOUD_API_ENABLED === true,
      plan: {
        tenants: plan.tenants,
        created: plan.created,
        cancelled: plan.cancelled
      },
      worker: {
        processed: worker.processed,
        simulasyon: worker.simulasyon,
        basarisiz: worker.basarisiz,
        deferredWindow: worker.deferredWindow,
        skippedManual: worker.skippedManual,
        skippedTemplateRequired: worker.skippedTemplateRequired
      }
    })
  )
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[bildirim:automation]', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
