import { randomUUID } from 'node:crypto'
import type { Request } from 'express'
import {
  ImportBatchStatus,
  KasaHareketTipi,
  OfisKasaIslemTipi,
  Prisma,
  type PrismaClient
} from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { writeAuditLog } from '../audit/auditService.js'
import { getRequestMeta } from '../auth/requestMeta.js'
import { computeGorunenAd } from '../muvekkil/muvekkil.service.js'
import {
  assertWhitelistTablesPresent,
  DESKTOP_IMPORT_TABLES,
  isLikelySqliteFile,
  openDesktopSqliteReadonly,
  selectAllRows
} from './desktopSqlite.js'
import {
  desktopRowId,
  mapDosyaDurumu,
  mapDosyaTuru,
  mapKasaOnay,
  mapKasaTipFromRow,
  mapMuvekkilTur,
  mapOfisIslemTipi,
  mapOfisOdeme,
  mapOfisOnay,
  mapOdemeYontemi,
  mapVekaletOdeme,
  parseSqliteDate,
  pickBool,
  pickCol,
  pickNum,
  pickStr
} from './desktopImportMappers.js'
import { sha256File } from './fileFingerprint.js'
import { assertNoCommittedDuplicate } from './importDuplicateGuard.js'
import type { ImportJsonCounts } from './desktopImportPreview.js'
import { validateDesktopRows } from './desktopImportValidate.js'

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>

function makeBelgeAllocator(
  reserved: Set<string>,
  batchShort: string
): (wanted: string | null | undefined) => { belgeNo: string; warning?: string } {
  return (wanted) => {
    let b = (wanted ?? '').trim()
    if (!b) b = `IMP-${batchShort}-EMPTY`
    if (!reserved.has(b)) {
      reserved.add(b)
      return { belgeNo: b }
    }
    const safe = b.replace(/[^\w.-]/g, '_').slice(0, 80)
    let alt = `IMP-${batchShort}-${safe}`
    let n = 0
    while (reserved.has(alt)) {
      n += 1
      alt = `IMP-${batchShort}-${safe}-${n}`
    }
    reserved.add(alt)
    return { belgeNo: alt, warning: `Belge no çakışması: "${b}" → "${alt}"` }
  }
}

async function loadBelgeReserved(tx: Tx, tenantId: string): Promise<Set<string>> {
  const [k, o] = await Promise.all([
    tx.kasaHareketi.findMany({ where: { tenantId }, select: { belgeNo: true } }),
    tx.ofisKasaHareketi.findMany({ where: { tenantId }, select: { belgeNo: true } })
  ])
  const s = new Set<string>()
  for (const x of k) s.add(x.belgeNo)
  for (const x of o) s.add(x.belgeNo)
  return s
}

function readOfficeSettingsPatch(row: Record<string, unknown> | undefined): {
  buroAdi?: string
  telefon?: string | null
  eposta?: string | null
  adres?: string | null
  vergiNo?: string | null
  vergiDairesi?: string | null
} {
  if (!row) return {}
  const patch: Record<string, unknown> = {}
  const buro = pickStr(row, 'buro_adi', 'buroAdi', 'office_name', 'name')
  if (buro?.trim()) patch.buroAdi = buro.trim()
  const tel = pickStr(row, 'telefon', 'phone')
  if (tel?.trim()) patch.telefon = tel.trim()
  const ep = pickStr(row, 'eposta', 'email', 'e_posta')
  if (ep?.trim()) patch.eposta = ep.trim()
  const adr = pickStr(row, 'adres', 'address')
  if (adr?.trim()) patch.adres = adr.trim()
  const vn = pickStr(row, 'vergi_no', 'vergiNo')
  if (vn?.trim()) patch.vergiNo = vn.trim()
  const vd = pickStr(row, 'vergi_dairesi', 'vergiDairesi')
  if (vd?.trim()) patch.vergiDairesi = vd.trim()
  return patch as {
    buroAdi?: string
    telefon?: string | null
    eposta?: string | null
    adres?: string | null
    vergiNo?: string | null
    vergiDairesi?: string | null
  }
}

function isOfisDuzeltme(r: Record<string, unknown>): boolean {
  if (pickBool(r, 'duzeltme_mi', 'duzeltmeMi')) return true
  const t = (pickStr(r, 'islem_tipi', 'islemTipi', 'tip') ?? '').toUpperCase()
  return t.includes('DUZELTME') || t.includes('DÜZELTME')
}

export type DesktopCommitResult = {
  importBatchId: string
  inserted: ImportJsonCounts
  warnings: string[]
}

export async function runDesktopImportCommit(params: {
  tenantId: string
  userId: string
  importBatchId: string
  filePath: string
  originalName: string
  req: Request
}): Promise<DesktopCommitResult> {
  const { tenantId, userId, importBatchId, filePath, originalName, req } = params
  const meta = getRequestMeta(req)

  if (!isLikelySqliteFile(filePath)) {
    throw new AppError(400, 'Yüklenen dosya geçerli bir SQLite veritabanı değil.', 'INVALID_SQLITE')
  }
  const fp = sha256File(filePath)
  await assertNoCommittedDuplicate(tenantId, fp)

  const batch = await prisma.importBatch.findFirst({
    where: { id: importBatchId, tenantId }
  })
  if (!batch || batch.status !== ImportBatchStatus.PREVIEWED) {
    throw new AppError(400, 'Geçersiz veya onaylanmamış içe aktarma kaydı.', 'IMPORT_BATCH_INVALID')
  }
  if (batch.sourceFingerprint !== fp) {
    throw new AppError(400, 'Yüklenen dosya ön kontrol ile aynı değil (parmak izi eşleşmiyor).', 'IMPORT_FINGERPRINT_MISMATCH')
  }

  const db = openDesktopSqliteReadonly(filePath)
  const commitWarnings: string[] = []
  try {
    const missing = assertWhitelistTablesPresent(db)
    if (missing.length) {
      throw new AppError(422, `Yedek şeması eksik: ${missing.join(', ')}`, 'IMPORT_SCHEMA_MISSING')
    }

    const muvekkilRows = selectAllRows(db, 'muvekkil')
    const dosyaRows = selectAllRows(db, 'dosya')
    const kasaRows = selectAllRows(db, 'dosya_kasa_hareket')
    const vekaletRows = selectAllRows(db, 'anlasilan_vekalet_ucreti')
    const taksitRows = selectAllRows(db, 'vekalet_ucreti_taksit')
    const ofisRows = selectAllRows(db, 'ofis_kasa_hareketleri')
    const officeRows = selectAllRows(db, 'office_settings')

    const valErrors = validateDesktopRows(muvekkilRows, dosyaRows, kasaRows, vekaletRows, taksitRows)
    if (valErrors.length) {
      throw new AppError(422, valErrors[0] ?? 'Doğrulama hatası', 'IMPORT_VALIDATION')
    }

    const inserted: ImportJsonCounts = {}
    for (const t of DESKTOP_IMPORT_TABLES) inserted[t] = 0

    const batchShort = importBatchId.replace(/-/g, '').slice(0, 8)

    try {
      await prisma.$transaction(
        async (tx) => {
          const reservedBelge = await loadBelgeReserved(tx, tenantId)
          const allocKasa = makeBelgeAllocator(reservedBelge, batchShort)
          const allocOfis = makeBelgeAllocator(reservedBelge, batchShort)

          const tenant = await tx.tenant.findFirst({ where: { id: tenantId, aktifMi: true } })
          if (!tenant) throw new Error('Tenant bulunamadı.')

          const officePatch = readOfficeSettingsPatch(officeRows[0])
          if (officeRows[0]) {
            const known = new Set([
              'id',
              'buro_adi',
              'buroAdi',
              'office_name',
              'name',
              'telefon',
              'phone',
              'eposta',
              'email',
              'e_posta',
              'adres',
              'address',
              'vergi_no',
              'vergiNo',
              'vergi_dairesi',
              'vergiDairesi',
              'created_at',
              'updated_at',
              'createdAt',
              'updatedAt'
            ])
            const unknownOfficeCols = Object.keys(officeRows[0]).filter((k) => !known.has(k))
            if (unknownOfficeCols.length) {
              commitWarnings.push(
                `Bazı masaüstü ofis ayarları SaaS tarafında henüz kullanılmadığı için aktarılmadı.` +
                  (unknownOfficeCols.length ? ` (${unknownOfficeCols.join(', ')})` : '')
              )
            }
          }

          await tx.tenant.update({
            where: { id: tenantId },
            data: {
              ...(officePatch.buroAdi && !tenant.buroAdi?.trim() ? { buroAdi: officePatch.buroAdi } : {}),
              ...(officePatch.telefon != null && !tenant.telefon?.trim() ? { telefon: officePatch.telefon } : {}),
              ...(officePatch.eposta != null && !tenant.eposta?.trim() ? { eposta: officePatch.eposta } : {}),
              ...(officePatch.adres != null && !tenant.adres?.trim() ? { adres: officePatch.adres } : {}),
              ...(officePatch.vergiNo != null && !tenant.vergiNo?.trim() ? { vergiNo: officePatch.vergiNo } : {}),
              ...(officePatch.vergiDairesi != null && !tenant.vergiDairesi?.trim()
                ? { vergiDairesi: officePatch.vergiDairesi }
                : {})
            }
          })
          if (officeRows.length) inserted.office_settings = 1

          const muvekkilIdMap = new Map<number, string>()
          for (const r of muvekkilRows) {
            const oldId = desktopRowId(r)
            if (oldId == null) continue
            const tur = mapMuvekkilTur(pickStr(r, 'tur', 'muvekkil_turu', 'type'))
            const adSoyad = pickStr(r, 'ad_soyad', 'adSoyad', 'adsoyad')?.trim() ?? ''
            const sirket = pickStr(r, 'sirket_unvani', 'sirketUnvani', 'unvan')
            const gorunenAd = computeGorunenAd(tur, adSoyad, sirket ?? null)
            const nid = randomUUID()
            await tx.muvekkil.create({
              data: {
                id: nid,
                tenantId,
                tur,
                gorunenAd,
                adSoyad,
                sirketUnvani: sirket?.trim() || null,
                telefon: pickStr(r, 'telefon', 'phone')?.trim() || null,
                eposta: pickStr(r, 'eposta', 'email')?.trim() || null,
                notMetni: pickStr(r, 'not_metni', 'not', 'notMetni')?.trim() || null,
                yetkiliAdSoyad: pickStr(r, 'yetkili_ad_soyad', 'yetkiliAdSoyad')?.trim() ?? '',
                yetkiliTelefon: pickStr(r, 'yetkili_telefon', 'yetkiliTelefon')?.trim() ?? '',
                mudurAdSoyad: pickStr(r, 'mudur_ad_soyad', 'mudurAdSoyad')?.trim() ?? '',
                mudurTelefon: pickStr(r, 'mudur_telefon', 'mudurTelefon')?.trim() ?? '',
                muhasebeAdSoyad: pickStr(r, 'muhasebe_ad_soyad', 'muhasebeAdSoyad')?.trim() ?? '',
                muhasebeTelefon: pickStr(r, 'muhasebe_telefon', 'muhasebeTelefon')?.trim() ?? '',
                aktifMi: !pickBool(r, 'pasif_mi', 'pasifMi', 'silindi_mi', 'deleted'),
                createdById: userId
              }
            })
            muvekkilIdMap.set(oldId, nid)
            inserted.muvekkil += 1
          }

          const dosyaIdMap = new Map<number, string>()
          for (const r of dosyaRows) {
            const oldId = desktopRowId(r)
            const oldMid = pickNum(r, 'muvekkil_id', 'muvekkilId')
            if (oldId == null || oldMid == null) continue
            const newMid = muvekkilIdMap.get(oldMid)
            if (!newMid) continue
            const nid = randomUUID()
            await tx.dosya.create({
              data: {
                id: nid,
                tenantId,
                muvekkilId: newMid,
                konuBasligi: pickStr(r, 'konu_basligi', 'konuBasligi', 'konu')?.trim() || 'İçe aktarılan dosya',
                mahkeme: pickStr(r, 'mahkeme', 'mahkemeAdi')?.trim() || null,
                icraDairesi: pickStr(r, 'icra_dairesi', 'icraDairesi')?.trim() || null,
                dosyaNo: pickStr(r, 'dosya_no', 'dosyaNo')?.trim() || null,
                dosyaTuru: mapDosyaTuru(pickStr(r, 'dosya_turu', 'dosyaTuru')),
                durum: mapDosyaDurumu(pickStr(r, 'durum')),
                aciklama: pickStr(r, 'aciklama')?.trim() || null,
                aktifMi: true,
                createdById: userId
              }
            })
            dosyaIdMap.set(oldId, nid)
            inserted.dosya += 1
          }

          const vekaletUcretiIdMap = new Map<number, string>()
          for (const r of vekaletRows) {
            const oldId = desktopRowId(r)
            const oldDid = pickNum(r, 'dosya_id', 'dosyaId')
            if (oldId == null || oldDid == null) continue
            const newDid = dosyaIdMap.get(oldDid)
            if (!newDid) continue
            const d = await tx.dosya.findFirst({ where: { id: newDid }, select: { muvekkilId: true } })
            if (!d) continue
            const oldMid = pickNum(r, 'muvekkil_id', 'muvekkilId')
            const newMid = oldMid != null ? muvekkilIdMap.get(oldMid) ?? d.muvekkilId : d.muvekkilId

            const tutarRaw = pickStr(r, 'anlasilan_tutar', 'toplam_tutar', 'toplamTutar', 'tutar')
            const tutar = new Prisma.Decimal(tutarRaw && tutarRaw.trim() ? tutarRaw.replace(',', '.') : '0')

            const nid = randomUUID()
            await tx.vekaletUcreti.create({
              data: {
                id: nid,
                tenantId,
                dosyaId: newDid,
                muvekkilId: newMid,
                toplamTutar: tutar,
                aciklama: pickStr(r, 'aciklama')?.trim() || null,
                createdById: userId
              }
            })
            vekaletUcretiIdMap.set(oldId, nid)
            inserted.anlasilan_vekalet_ucreti += 1
          }

          for (const r of taksitRows) {
            if (desktopRowId(r) == null) continue
            const oldVid = pickNum(r, 'vekalet_ucreti_id', 'anlasilan_vekalet_ucreti_id', 'vekaletUcretiId')
            if (oldVid == null) continue
            const newVid = vekaletUcretiIdMap.get(oldVid)
            if (!newVid) continue
            const vu = await tx.vekaletUcreti.findFirst({
              where: { id: newVid },
              select: { dosyaId: true, muvekkilId: true }
            })
            if (!vu) continue
            const vade = parseSqliteDate(pickCol(r, 'vade_tarihi', 'vadeTarihi', 'vade')) ?? new Date()
            const tutarStr = pickStr(r, 'tutar') ?? '0'
            const tutar = new Prisma.Decimal(tutarStr.replace(',', '.'))
            const odemeDurumu = mapVekaletOdeme(r)
            const nid = randomUUID()
            const no = pickNum(r, 'taksit_no', 'taksitNo') ?? 1
            await tx.vekaletTaksiti.create({
              data: {
                id: nid,
                tenantId,
                dosyaId: vu.dosyaId,
                muvekkilId: vu.muvekkilId,
                vekaletUcretiId: newVid,
                taksitNo: no,
                vadeTarihi: vade,
                tutar,
                odemeDurumu,
                odemeTarihi: parseSqliteDate(pickCol(r, 'odeme_tarihi', 'odemeTarihi')),
                aciklama: pickStr(r, 'aciklama')?.trim() || null,
                makbuzNo: pickStr(r, 'makbuz_no', 'makbuzNo')?.trim() || null,
                smmKesildiMi: pickBool(r, 'smm_kesildi_mi', 'smmKesildiMi'),
                smmKesimTarihi: parseSqliteDate(pickCol(r, 'smm_kesim_tarihi', 'smmKesimTarihi')),
                smmNo: pickStr(r, 'smm_no', 'smmNo')?.trim() || null,
                smmAciklama: pickStr(r, 'smm_aciklama', 'smmAciklama')?.trim() || null,
                createdById: userId
              }
            })
            inserted.vekalet_ucreti_taksit += 1
          }

          const kasaHareketIdMap = new Map<number, string>()
          const kasaNormal = kasaRows.filter((r) => mapKasaTipFromRow(r) !== KasaHareketTipi.DUZELTME)
          const kasaDuz = kasaRows.filter((r) => mapKasaTipFromRow(r) === KasaHareketTipi.DUZELTME)

          for (const r of kasaNormal) {
            const oldId = desktopRowId(r)
            if (oldId == null) continue
            const oldDid = pickNum(r, 'dosya_id', 'dosyaId')
            const oldMid = pickNum(r, 'muvekkil_id', 'muvekkilId')
            if (oldDid == null) continue
            const newDid = dosyaIdMap.get(oldDid)
            if (!newDid) continue
            const d = await tx.dosya.findFirst({ where: { id: newDid }, select: { muvekkilId: true } })
            if (!d) continue
            const newMid = oldMid != null ? muvekkilIdMap.get(oldMid) ?? d.muvekkilId : d.muvekkilId
            const tip = mapKasaTipFromRow(r)
            const tarih = parseSqliteDate(pickCol(r, 'tarih', 'hareket_tarihi')) ?? new Date()
            const tutarStr = pickStr(r, 'tutar') ?? '0'
            const tutar = new Prisma.Decimal(tutarStr.replace(',', '.'))
            const rawBelge = pickStr(r, 'belge_no', 'belgeNo', 'belge')
            const { belgeNo, warning } = allocKasa(rawBelge)
            if (warning) commitWarnings.push(warning)

            const onayDurumu = mapKasaOnay(pickStr(r, 'onay_durumu', 'onayDurumu'))
            const nid = randomUUID()
            await tx.kasaHareketi.create({
              data: {
                id: nid,
                tenantId,
                dosyaId: newDid,
                muvekkilId: newMid,
                tip,
                tarih,
                masrafTuru: pickStr(r, 'masraf_turu', 'masrafTuru')?.trim() || null,
                ozelMasrafAdi: pickStr(r, 'ozel_masraf_adi', 'ozelMasrafAdi')?.trim() || null,
                aciklama: pickStr(r, 'aciklama')?.trim() || null,
                tutar,
                odemeYontemi: mapOdemeYontemi(pickStr(r, 'odeme_yontemi', 'odemeYontemi')),
                masrafiYapanKisi:
                  pickStr(r, 'masrafi_yapan_kisi', 'masrafiYapanKisi')?.trim() ||
                  (tip === KasaHareketTipi.MASRAF ? 'İçe aktarım' : null),
                belgeNo,
                onayDurumu,
                onaylayanId: onayDurumu === 'ONAYLI' ? userId : null,
                onayTarihi: onayDurumu === 'ONAYLI' ? tarih : null,
                redSebebi: pickStr(r, 'red_sebebi', 'redSebebi')?.trim() || null,
                orijinalHareketId: null,
                otomatikOnayMi: false,
                createdById: userId
              }
            })
            kasaHareketIdMap.set(oldId, nid)
            inserted.dosya_kasa_hareket += 1
          }

          for (const r of kasaDuz) {
            const oldId = desktopRowId(r)
            if (oldId == null) continue
            const oldDid = pickNum(r, 'dosya_id', 'dosyaId')
            const oldMid = pickNum(r, 'muvekkil_id', 'muvekkilId')
            const oldOrij = pickNum(r, 'orijinal_hareket_id', 'orijinalHareketId', 'orijinal_id')
            if (oldDid == null || oldOrij == null) continue
            const newDid = dosyaIdMap.get(oldDid)
            const newOrij = kasaHareketIdMap.get(oldOrij)
            if (!newDid || !newOrij) continue
            const d = await tx.dosya.findFirst({ where: { id: newDid }, select: { muvekkilId: true } })
            if (!d) continue
            const newMid = oldMid != null ? muvekkilIdMap.get(oldMid) ?? d.muvekkilId : d.muvekkilId
            const tarih = parseSqliteDate(pickCol(r, 'tarih', 'hareket_tarihi')) ?? new Date()
            const tutarStr = pickStr(r, 'tutar') ?? '0'
            const tutar = new Prisma.Decimal(tutarStr.replace(',', '.'))
            const rawBelge = pickStr(r, 'belge_no', 'belgeNo', 'belge')
            const { belgeNo, warning } = allocKasa(rawBelge)
            if (warning) commitWarnings.push(warning)
            const onayDurumu = mapKasaOnay(pickStr(r, 'onay_durumu', 'onayDurumu'))
            const nid = randomUUID()
            await tx.kasaHareketi.create({
              data: {
                id: nid,
                tenantId,
                dosyaId: newDid,
                muvekkilId: newMid,
                tip: KasaHareketTipi.DUZELTME,
                tarih,
                masrafTuru: null,
                ozelMasrafAdi: null,
                aciklama: pickStr(r, 'aciklama')?.trim() || 'Düzeltme (içe aktarım)',
                tutar,
                odemeYontemi: null,
                masrafiYapanKisi: null,
                belgeNo,
                onayDurumu,
                onaylayanId: onayDurumu === 'ONAYLI' ? userId : null,
                onayTarihi: onayDurumu === 'ONAYLI' ? tarih : null,
                redSebebi: null,
                orijinalHareketId: newOrij,
                otomatikOnayMi: false,
                createdById: userId
              }
            })
            kasaHareketIdMap.set(oldId, nid)
            inserted.dosya_kasa_hareket += 1
          }

          const ofisNormal = ofisRows.filter((r) => !isOfisDuzeltme(r))
          const ofisDuz = ofisRows.filter(isOfisDuzeltme)
          const ofisIdMap = new Map<number, string>()

          for (const r of ofisNormal) {
            const oldId = desktopRowId(r)
            if (oldId == null) continue
            const tipRaw = pickStr(r, 'islem_tipi', 'islemTipi', 'tip')
            const islemTipi = mapOfisIslemTipi(tipRaw, false)
            const tarih = parseSqliteDate(pickCol(r, 'tarih')) ?? new Date()
            const tutarStr = pickStr(r, 'tutar') ?? '0'
            const tutar = new Prisma.Decimal(tutarStr.replace(',', '.'))
            const rawBelge = pickStr(r, 'belge_no', 'belgeNo', 'belge')
            const { belgeNo, warning } = allocOfis(rawBelge)
            if (warning) commitWarnings.push(warning)
            const onayDurumu = mapOfisOnay(pickStr(r, 'onay_durumu', 'onayDurumu'))
            const nid = randomUUID()
            await tx.ofisKasaHareketi.create({
              data: {
                id: nid,
                tenantId,
                islemTipi,
                tarih,
                kategori: pickStr(r, 'kategori', 'category')?.trim() || 'Diğer',
                ozelKategoriAdi: pickStr(r, 'ozel_kategori_adi', 'ozelKategoriAdi')?.trim() || null,
                aciklama: pickStr(r, 'aciklama')?.trim() || null,
                tutar,
                odemeYontemi: mapOfisOdeme(pickStr(r, 'odeme_yontemi', 'odemeYontemi')),
                belgeNo,
                onayDurumu,
                onaylayanId: onayDurumu === 'ONAYLI' ? userId : null,
                onayTarihi: onayDurumu === 'ONAYLI' ? tarih : null,
                redSebebi: pickStr(r, 'red_sebebi', 'redSebebi')?.trim() || null,
                orijinalHareketId: null,
                otomatikOnayMi: false,
                createdById: userId
              }
            })
            ofisIdMap.set(oldId, nid)
            inserted.ofis_kasa_hareketleri += 1
          }

          for (const r of ofisDuz) {
            const oldId = desktopRowId(r)
            const oldOrij = pickNum(r, 'orijinal_hareket_id', 'orijinalHareketId')
            if (oldId == null || oldOrij == null) continue
            const newOrij = ofisIdMap.get(oldOrij)
            if (!newOrij) continue
            const tarih = parseSqliteDate(pickCol(r, 'tarih')) ?? new Date()
            const tutarStr = pickStr(r, 'tutar') ?? '0'
            const tutar = new Prisma.Decimal(tutarStr.replace(',', '.'))
            const rawBelge = pickStr(r, 'belge_no', 'belgeNo', 'belge')
            const { belgeNo, warning } = allocOfis(rawBelge)
            if (warning) commitWarnings.push(warning)
            const onayDurumu = mapOfisOnay(pickStr(r, 'onay_durumu', 'onayDurumu'))
            const nid = randomUUID()
            await tx.ofisKasaHareketi.create({
              data: {
                id: nid,
                tenantId,
                islemTipi: OfisKasaIslemTipi.DUZELTME,
                tarih,
                kategori: pickStr(r, 'kategori', 'kategori_adi')?.trim() || 'Düzeltme',
                ozelKategoriAdi: pickStr(r, 'ozel_kategori_adi', 'ozelKategoriAdi')?.trim() || null,
                aciklama: pickStr(r, 'aciklama')?.trim() || 'Düzeltme (içe aktarım)',
                tutar,
                odemeYontemi: mapOfisOdeme(pickStr(r, 'odeme_yontemi', 'odemeYontemi')),
                belgeNo,
                onayDurumu,
                onaylayanId: onayDurumu === 'ONAYLI' ? userId : null,
                onayTarihi: onayDurumu === 'ONAYLI' ? tarih : null,
                redSebebi: null,
                orijinalHareketId: newOrij,
                otomatikOnayMi: false,
                createdById: userId
              }
            })
            ofisIdMap.set(oldId, nid)
            inserted.ofis_kasa_hareketleri += 1
          }

          await tx.importBatch.update({
            where: { id: importBatchId },
            data: {
              status: ImportBatchStatus.COMMITTED,
              committedAt: new Date(),
              committedById: userId,
              rowCounts: inserted as Prisma.InputJsonValue,
              warnings: commitWarnings as Prisma.InputJsonValue
            }
          })
        },
        { timeout: 180_000 }
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const errArr = [msg]
      await prisma.importBatch.update({
        where: { id: importBatchId },
        data: {
          status: ImportBatchStatus.FAILED,
          errors: errArr as Prisma.InputJsonValue
        }
      })
      await writeAuditLog({
        tenantId,
        userId,
        action: 'DESKTOP_IMPORT_FAILED',
        entityType: 'ImportBatch',
        entityId: importBatchId,
        newValue: { message: msg, fileName: originalName },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      })
      throw new AppError(500, `İçe aktarım başarısız: ${msg}`, 'IMPORT_COMMIT_FAILED')
    }

    await writeAuditLog({
      tenantId,
      userId,
      action: 'DESKTOP_IMPORT_COMMITTED',
      entityType: 'ImportBatch',
      entityId: importBatchId,
      newValue: { inserted, fileName: originalName },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    })

    return { importBatchId, inserted, warnings: commitWarnings }
  } finally {
    db.close()
  }
}
