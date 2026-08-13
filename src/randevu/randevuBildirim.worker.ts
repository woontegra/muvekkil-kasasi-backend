/**
 * Randevu WhatsApp hatırlatma worker — gerçek Meta çağrısı feature flag + onaylı şablon ile.
 */
import {
  BildirimIsDurumu,
  BildirimPlanKaynagi,
  BildirimProvider
} from '@prisma/client'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { evaluateAutoBildirimEligibility } from '../tahsilatBildirim/eligibility.service.js'
import { maskPhone, normalizeTurkiyePhone } from '../tahsilatBildirim/phone.js'
import { isWhatsAppCloudApiAllowed, resolveWhatsAppProvider } from '../tahsilatBildirim/providers/whatsappProvider.js'
import { isWhatsAppBaglantiConnected } from '../tahsilatBildirim/connection.public.js'
import { renderTemplate, type TemplateVars } from '../tahsilatBildirim/templates.js'
import { getLibraryEntry, getLibraryEntryByMetaName } from '../tahsilatBildirim/templateLibrary.catalog.js'
import { buildSendBodyComponentsFromVars } from '../tahsilatBildirim/templateLibrary.components.js'
import { minutesNowTr } from '../tahsilatBildirim/time.js'
import {
  ATLAMA_TEMPLATE_DEGISKEN_EKSIK,
  ATLAMA_TEMPLATE_GEREKLI,
  ATLAMA_UYGUN_TEMPLATE_YOK
} from '../tahsilatBildirim/worker.service.js'

function resolvePhone(muvekkil: {
  telefon: string | null
  yetkiliTelefon: string
}): string | null {
  const candidates = [muvekkil.telefon ?? '', muvekkil.yetkiliTelefon ?? '']
  for (const c of candidates) {
    const n = c.trim() ? normalizeTurkiyePhone(c) : null
    if (n) return n
  }
  return null
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

function fmtDateTr(d: Date): string {
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtTimeTr(d: Date): string {
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

export type ProcessDueRandevuJobsOptions = {
  limit?: number
  workerId?: string
  simulateOnly?: boolean
  tenantId?: string
}

export type ProcessDueRandevuJobsResult = {
  processed: number
  simulasyon: number
  basarisiz: number
  atlananTelefon: number
  atlananIzin: number
  atlananSablon: number
  skippedAlreadyDone: number
  skippedManual: number
  skippedTemplateRequired: number
}

type LockedRow = { id: string }

async function claimDueRandevuJobs(opts: {
  limit: number
  workerId: string
  tenantId?: string
  now: Date
}): Promise<string[]> {
  const lockStaleBefore = new Date(opts.now.getTime() - 15 * 60 * 1000)

  return prisma.$transaction(async (tx) => {
    const rows =
      opts.tenantId != null
        ? await tx.$queryRaw<LockedRow[]>`
          SELECT id FROM randevu_bildirim_isi
          WHERE tenant_id = ${opts.tenantId}::uuid
            AND durum IN ('PLANLANDI'::"BildirimIsDurumu", 'KUYRUKTA'::"BildirimIsDurumu")
            AND planlanan_at <= ${opts.now}
            AND (locked_at IS NULL OR locked_at < ${lockStaleBefore})
          ORDER BY planlanan_at ASC
          LIMIT ${opts.limit}
          FOR UPDATE SKIP LOCKED
        `
        : await tx.$queryRaw<LockedRow[]>`
          SELECT id FROM randevu_bildirim_isi
          WHERE durum IN ('PLANLANDI'::"BildirimIsDurumu", 'KUYRUKTA'::"BildirimIsDurumu")
            AND planlanan_at <= ${opts.now}
            AND (locked_at IS NULL OR locked_at < ${lockStaleBefore})
          ORDER BY planlanan_at ASC
          LIMIT ${opts.limit}
          FOR UPDATE SKIP LOCKED
        `

    if (rows.length === 0) return []

    const ids = rows.map((r) => r.id)
    await tx.randevuBildirimIsi.updateMany({
      where: { id: { in: ids } },
      data: {
        durum: BildirimIsDurumu.KUYRUKTA,
        lockedAt: opts.now,
        lockedBy: opts.workerId
      }
    })
    return ids
  })
}

export async function processDueRandevuJobs(
  options: ProcessDueRandevuJobsOptions = {}
): Promise<ProcessDueRandevuJobsResult> {
  const empty = (): ProcessDueRandevuJobsResult => ({
    processed: 0,
    simulasyon: 0,
    basarisiz: 0,
    atlananTelefon: 0,
    atlananIzin: 0,
    atlananSablon: 0,
    skippedAlreadyDone: 0,
    skippedManual: 0,
    skippedTemplateRequired: 0
  })

  if (!env.WHATSAPP_AUTOMATION_ENABLED) return empty()

  const limit = Math.max(1, Math.min(options.limit ?? 50, 200))
  const workerId = options.workerId ?? `randevu-worker-${process.pid}`
  const now = new Date()
  const minutes = minutesNowTr(now)

  const result = empty()
  const ids = await claimDueRandevuJobs({ limit, workerId, tenantId: options.tenantId, now })

  for (const id of ids) {
    result.processed += 1

    const job = await prisma.randevuBildirimIsi.findUnique({
      where: { id },
      include: {
        muvekkil: true,
        randevu: true,
        tenant: { select: { buroAdi: true } }
      }
    })
    if (!job || !job.randevu.aktifMi) continue

    if (
      job.durum === BildirimIsDurumu.GONDERILDI ||
      job.durum === BildirimIsDurumu.TESLIM_EDILDI ||
      job.durum === BildirimIsDurumu.OKUNDU
    ) {
      result.skippedAlreadyDone += 1
      await prisma.randevuBildirimIsi.update({
        where: { id },
        data: { lockedAt: null, lockedBy: null }
      })
      continue
    }

    const ayar = await prisma.randevuBildirimAyar.findUnique({ where: { tenantId: job.tenantId } })
    if (!ayar?.otomasyonAktif && !options.simulateOnly) {
      await prisma.randevuBildirimIsi.update({
        where: { id },
        data: { durum: BildirimIsDurumu.PLANLANDI, lockedAt: null, lockedBy: null }
      })
      continue
    }

    const tahsilatAyar = await prisma.tahsilatBildirimAyar.findUnique({ where: { tenantId: job.tenantId } })
    const winStart = tahsilatAyar?.izinliSaatBaslangic ?? 600
    const winEnd = tahsilatAyar?.izinliSaatBitis ?? 1200
    if (minutes < winStart || minutes >= winEnd) {
      await prisma.randevuBildirimIsi.update({
        where: { id },
        data: { durum: BildirimIsDurumu.PLANLANDI, lockedAt: null, lockedBy: null }
      })
      continue
    }

    const elig = evaluateAutoBildirimEligibility({
      tenantOtomasyonAktif: Boolean(ayar?.otomasyonAktif),
      muvekkilIzni: job.muvekkil.otomatikBildirimIzni,
      dosyaAktif: true,
      taksitAktif: true
    })
    if (!elig.eligible) {
      result.atlananIzin += 1
      await prisma.randevuBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.ATLANDI,
          atlamaNedeni: elig.kullaniciMesaji,
          lockedAt: null,
          lockedBy: null
        }
      })
      continue
    }

    const phoneE164 = resolvePhone(job.muvekkil)
    if (!phoneE164) {
      result.atlananTelefon += 1
      await prisma.randevuBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.ATLANDI,
          atlamaNedeni: 'Telefon bulunamadı',
          lockedAt: null,
          lockedBy: null
        }
      })
      continue
    }

    const baslangic = job.randevu.baslangicAt
    const vars: TemplateVars = {
      muvekkilAdi: job.muvekkil.gorunenAd,
      buroAdi: job.tenant.buroAdi,
      randevuTarihi: fmtDateTr(baslangic),
      randevuSaati: fmtTimeTr(baslangic)
    }

    let metaSablon = job.metaSablonId
      ? await prisma.whatsAppMetaSablon.findFirst({
          where: { id: job.metaSablonId, tenantId: job.tenantId }
        })
      : null

    if (!metaSablon && job.planKaynagi === BildirimPlanKaynagi.VARSAYILAN) {
      const varsayilan = await prisma.randevuBildirimVarsayilanKural.findFirst({
        where: { tenantId: job.tenantId, offsetDk: job.offsetDk, aktifMi: true },
        include: { metaSablon: true }
      })
      metaSablon = varsayilan?.metaSablon ?? null
    }

    const baglanti = await prisma.whatsAppBaglanti.findUnique({ where: { tenantId: job.tenantId } })
    const cloudReady =
      isWhatsAppCloudApiAllowed() && isWhatsAppBaglantiConnected(baglanti?.durum)

    const libraryKey =
      metaSablon?.libraryKey ||
      (metaSablon ? getLibraryEntryByMetaName(metaSablon.metaName)?.libraryKey : null) ||
      'RANDEVU_HATIRLATMA'
    const entry = getLibraryEntry(libraryKey)
    const templateText = entry?.bodyAppText ?? ''

    const rendered = renderTemplate(templateText, vars)
    if (!rendered.ok) {
      result.atlananSablon += 1
      await prisma.randevuBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.ATLANDI,
          atlamaNedeni: `Şablon değişkenleri eksik: ${rendered.missing.join(', ')}`,
          lockedAt: null,
          lockedBy: null
        }
      })
      continue
    }

    if (!options.simulateOnly && !cloudReady) {
      result.skippedManual += 1
      await prisma.randevuBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.PLANLANDI,
          provider: BildirimProvider.MANUAL_WHATSAPP,
          telefonMaskeli: maskPhone(phoneE164),
          lockedAt: null,
          lockedBy: null
        }
      })
      continue
    }

    if (!options.simulateOnly && cloudReady) {
      const sharedImportConn = Boolean(baglanti && !baglanti.webhookOverrideActive)
      if (!metaSablon || metaSablon.statusNormalized !== 'ONAYLANDI' || !entry) {
        result.skippedTemplateRequired += 1
        await prisma.randevuBildirimIsi.update({
          where: { id },
          data: {
            durum: BildirimIsDurumu.ATLANDI,
            provider: BildirimProvider.WHATSAPP_CLOUD_API,
            telefonMaskeli: maskPhone(phoneE164),
            atlamaNedeni: sharedImportConn
              ? `${ATLAMA_UYGUN_TEMPLATE_YOK}: ${ATLAMA_TEMPLATE_GEREKLI}`
              : `${ATLAMA_UYGUN_TEMPLATE_YOK}: ${ATLAMA_TEMPLATE_GEREKLI}`,
            lockedAt: null,
            lockedBy: null
          }
        })
        continue
      }

      const built = buildSendBodyComponentsFromVars(entry, vars)
      if (!built.ok) {
        result.atlananSablon += 1
        await prisma.randevuBildirimIsi.update({
          where: { id },
          data: {
            durum: BildirimIsDurumu.ATLANDI,
            atlamaNedeni: `${ATLAMA_TEMPLATE_DEGISKEN_EKSIK}: ${built.missing.join(', ')}`,
            lockedAt: null,
            lockedBy: null
          }
        })
        continue
      }

      const provider = resolveWhatsAppProvider('WHATSAPP_CLOUD_API')
      const sendResult = await provider.send({
        tenantId: job.tenantId,
        toE164: phoneE164,
        text: rendered.text,
        idempotencyKey: job.idempotencyKey,
        templateName: metaSablon.metaName,
        templateLanguage: metaSablon.language,
        templateComponents: built.components as unknown as Array<Record<string, unknown>>
      })

      const telefonMaskeli = maskPhone(phoneE164)
      if (sendResult.ok) {
        result.simulasyon += 1
        await prisma.randevuBildirimIsi.update({
          where: { id },
          data: {
            durum: BildirimIsDurumu.GONDERILDI,
            denemeSayisi: { increment: 1 },
            telefonMaskeli,
            provider: BildirimProvider.WHATSAPP_CLOUD_API,
            providerMessageId: sendResult.providerMessageId ?? null,
            lockedAt: null,
            lockedBy: null
          }
        })
      } else {
        result.basarisiz += 1
        await prisma.randevuBildirimIsi.update({
          where: { id },
          data: {
            durum: BildirimIsDurumu.BASARISIZ,
            hataOzeti: sendResult.message,
            telefonMaskeli,
            denemeSayisi: { increment: 1 },
            lockedAt: null,
            lockedBy: null
          }
        })
      }
      continue
    }

    const provider = resolveWhatsAppProvider('MANUAL_WHATSAPP')
    const sendResult = await provider.send({
      tenantId: job.tenantId,
      toE164: phoneE164,
      text: rendered.text,
      idempotencyKey: job.idempotencyKey,
      templateName: null,
      templateLanguage: null
    })

    if (sendResult.ok || options.simulateOnly) {
      result.simulasyon += 1
      await prisma.randevuBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.SIMULASYON_TAMAMLANDI,
          denemeSayisi: { increment: 1 },
          telefonMaskeli: maskPhone(phoneE164),
          provider: BildirimProvider.MANUAL_WHATSAPP,
          lockedAt: null,
          lockedBy: null
        }
      })
    } else {
      result.basarisiz += 1
      await prisma.randevuBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.BASARISIZ,
          hataOzeti: sendResult.message,
          lockedAt: null,
          lockedBy: null
        }
      })
    }
  }

  return result
}
