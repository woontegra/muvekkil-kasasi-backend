import {
  BildirimIsDurumu,
  BildirimKanali,
  BildirimKuralTuru,
  Prisma
} from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { maskPhone, normalizeTurkiyePhone } from './phone.js'
import { getWhatsAppProvider } from './providers/whatsappProvider.js'
import { renderTemplate, type TemplateVars } from './templates.js'
import { minutesNowTr, ymdTr } from './time.js'

function sumOdeme(tutarlar: { tutar: { toString: () => string } }[]): number {
  return tutarlar.reduce((s, o) => s + Number(o.tutar), 0)
}

function fmtMoney(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function fmtVadeTr(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}.${m}.${y}`
}

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

export type ProcessDueJobsOptions = {
  limit?: number
  workerId?: string
  simulateOnly?: boolean
  tenantId?: string
}

export type ProcessDueJobsResult = {
  processed: number
  simulasyon: number
  atlananTelefon: number
  atlananIzin: number
  atlananDosya: number
  atlananSablon: number
  basarisiz: number
  skippedAlreadyDone: number
  deferredWindow: number
}

type LockedRow = { id: string }

async function claimDueJobs(opts: {
  limit: number
  workerId: string
  tenantId?: string
  now: Date
}): Promise<string[]> {
  const lockStaleBefore = new Date(opts.now.getTime() - 15 * 60 * 1000)

  return prisma.$transaction(async (tx) => {
    const rows = opts.tenantId
      ? await tx.$queryRaw<LockedRow[]>`
          SELECT id FROM tahsilat_bildirim_isi
          WHERE durum IN ('PLANLANDI', 'KUYRUKTA')
            AND planlanan_at <= ${opts.now}
            AND tenant_id = ${opts.tenantId}
            AND (locked_at IS NULL OR locked_at < ${lockStaleBefore})
          ORDER BY planlanan_at ASC
          LIMIT ${opts.limit}
          FOR UPDATE SKIP LOCKED
        `
      : await tx.$queryRaw<LockedRow[]>`
          SELECT id FROM tahsilat_bildirim_isi
          WHERE durum IN ('PLANLANDI', 'KUYRUKTA')
            AND planlanan_at <= ${opts.now}
            AND (locked_at IS NULL OR locked_at < ${lockStaleBefore})
          ORDER BY planlanan_at ASC
          LIMIT ${opts.limit}
          FOR UPDATE SKIP LOCKED
        `

    if (rows.length === 0) return []

    const ids = rows.map((r) => r.id)
    await tx.tahsilatBildirimIsi.updateMany({
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

export async function processDueJobs(
  options: ProcessDueJobsOptions = {}
): Promise<ProcessDueJobsResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200))
  const workerId = options.workerId ?? `worker-${process.pid}`
  const now = new Date()
  const todayYmd = ymdTr(now)
  const minutes = minutesNowTr(now)

  const result: ProcessDueJobsResult = {
    processed: 0,
    simulasyon: 0,
    atlananTelefon: 0,
    atlananIzin: 0,
    atlananDosya: 0,
    atlananSablon: 0,
    basarisiz: 0,
    skippedAlreadyDone: 0,
    deferredWindow: 0
  }

  const ids = await claimDueJobs({
    limit,
    workerId,
    tenantId: options.tenantId,
    now
  })

  for (const id of ids) {
    result.processed += 1

    const job = await prisma.tahsilatBildirimIsi.findUnique({
      where: { id },
      include: {
        muvekkil: true,
        dosya: true,
        taksit: { include: { odemeler: { select: { tutar: true } } } },
        tenant: { select: { buroAdi: true } }
      }
    })

    if (!job) continue

    if (
      job.durum === BildirimIsDurumu.SIMULASYON_TAMAMLANDI ||
      job.durum === BildirimIsDurumu.GONDERILDI ||
      job.durum === BildirimIsDurumu.TESLIM_EDILDI ||
      job.durum === BildirimIsDurumu.OKUNDU
    ) {
      result.skippedAlreadyDone += 1
      await prisma.tahsilatBildirimIsi.update({
        where: { id },
        data: { lockedAt: null, lockedBy: null }
      })
      continue
    }

    const ayar = await prisma.tahsilatBildirimAyar.findUnique({
      where: { tenantId: job.tenantId }
    })
    if (!ayar?.otomasyonAktif && !options.simulateOnly) {
      await prisma.tahsilatBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.PLANLANDI,
          lockedAt: null,
          lockedBy: null
        }
      })
      continue
    }

    const testModu = options.simulateOnly === true ? true : (ayar?.testModu ?? true)
    const winStart = ayar?.izinliSaatBaslangic ?? 600
    const winEnd = ayar?.izinliSaatBitis ?? 1200

    if (minutes < winStart || minutes >= winEnd) {
      result.deferredWindow += 1
      await prisma.tahsilatBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.PLANLANDI,
          lockedAt: null,
          lockedBy: null
        }
      })
      continue
    }

    if (!job.muvekkil.otomatikBildirimIzni) {
      result.atlananIzin += 1
      await prisma.tahsilatBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.ATLANDI,
          atlamaNedeni: 'Bildirim izni kapalı',
          lockedAt: null,
          lockedBy: null
        }
      })
      continue
    }

    if (!job.dosya.otomatikBildirimAktif) {
      result.atlananDosya += 1
      await prisma.tahsilatBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.ATLANDI,
          atlamaNedeni: 'Dosyada otomasyon kapalı',
          lockedAt: null,
          lockedBy: null
        }
      })
      continue
    }

    const phoneE164 = resolvePhone(job.muvekkil)
    if (!phoneE164) {
      result.atlananTelefon += 1
      await prisma.tahsilatBildirimIsi.update({
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

    const odenen = sumOdeme(job.taksit.odemeler)
    const taksitTutari = Number(job.taksit.tutar)
    const kalan = Math.max(0, taksitTutari - odenen)
    if (kalan <= 0.001) {
      await prisma.tahsilatBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.IPTAL_EDILDI,
          iptalNedeni: 'Borç kapandı',
          lockedAt: null,
          lockedBy: null
        }
      })
      continue
    }

    const sablon = await prisma.tahsilatBildirimSablonu.findUnique({
      where: {
        tenantId_kuralTuru_kanal: {
          tenantId: job.tenantId,
          kuralTuru: job.kuralTuru,
          kanal: BildirimKanali.WHATSAPP
        }
      }
    })

    const vadeYmd = ymdTr(job.taksit.vadeTarihi)
    const gecikme =
      job.kuralTuru === BildirimKuralTuru.VADE_SONRASI
        ? Math.max(0, Math.round((new Date(`${todayYmd}T12:00:00+03:00`).getTime() - new Date(`${vadeYmd}T12:00:00+03:00`).getTime()) / 86_400_000))
        : 0

    const dosyaBilgisi = job.dosya.dosyaNo
      ? `${job.dosya.konuBasligi} (${job.dosya.dosyaNo})`
      : job.dosya.konuBasligi

    const vars: TemplateVars = {
      muvekkilAdi: job.muvekkil.gorunenAd,
      buroAdi: job.tenant.buroAdi,
      dosyaBilgisi,
      taksitTutari: fmtMoney(taksitTutari),
      odenenTutar: fmtMoney(odenen),
      kalanTutar: fmtMoney(kalan),
      vadeTarihi: fmtVadeTr(vadeYmd),
      gecikmeGunu: String(gecikme || (job.kuralTuru === BildirimKuralTuru.VADE_SONRASI ? 1 : 0))
    }

    const rendered = renderTemplate(sablon?.metin ?? '', vars)
    if (!sablon || !rendered.ok) {
      result.atlananSablon += 1
      await prisma.tahsilatBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.ATLANDI,
          atlamaNedeni: !sablon
            ? 'Şablon bulunamadı'
            : `Şablon değişkenleri eksik: ${rendered.ok === false ? rendered.missing.join(', ') : ''}`,
          lockedAt: null,
          lockedBy: null
        }
      })
      continue
    }

    const provider = getWhatsAppProvider(testModu)
    const sendResult = await provider.send({
      tenantId: job.tenantId,
      toE164: phoneE164,
      text: rendered.text,
      idempotencyKey: job.idempotencyKey
    })

    const telefonMaskeli = maskPhone(phoneE164)
    const denemeAt = new Date()

    if (sendResult.ok && sendResult.provider === 'MOCK_SIMULATION') {
      result.simulasyon += 1
      await prisma.$transaction([
        prisma.tahsilatBildirimDeneme.create({
          data: {
            tenantId: job.tenantId,
            isId: job.id,
            provider: sendResult.provider,
            basariliMi: true,
            telefonMaskeli,
            sablonOzeti: truncate(sablon.metin, 200),
            mesajOzeti: truncate(rendered.text, 280),
            sonucKodu: sendResult.code,
            sonucMesaji: sendResult.message
          }
        }),
        prisma.tahsilatBildirimIsi.update({
          where: { id },
          data: {
            durum: BildirimIsDurumu.SIMULASYON_TAMAMLANDI,
            kalanTutarSnapshot: new Prisma.Decimal(kalan.toFixed(2)),
            denemeSayisi: { increment: 1 },
            sonDenemeAt: denemeAt,
            lockedAt: null,
            lockedBy: null,
            hataOzeti: null,
            atlamaNedeni: null
          }
        })
      ])
      continue
    }

    // Meta kapalı / yapılandırılmamış — sahte başarı yok
    result.basarisiz += 1
    const msg = sendResult.message || 'WhatsApp otomatik gönderimi henüz aktif değil'
    await prisma.$transaction([
      prisma.tahsilatBildirimDeneme.create({
        data: {
          tenantId: job.tenantId,
          isId: job.id,
          provider: sendResult.provider || 'META_DISABLED',
          basariliMi: false,
          telefonMaskeli,
          sablonOzeti: truncate(sablon.metin, 200),
          mesajOzeti: truncate(rendered.text, 280),
          sonucKodu: sendResult.code || 'DISABLED',
          sonucMesaji: msg
        }
      }),
      prisma.tahsilatBildirimIsi.update({
        where: { id },
        data: {
          durum: BildirimIsDurumu.BASARISIZ,
          hataOzeti: msg,
          denemeSayisi: { increment: 1 },
          sonDenemeAt: denemeAt,
          lockedAt: null,
          lockedBy: null
        }
      })
    ])
  }

  return result
}
