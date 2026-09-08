# WhatsApp automation cron (Railway)

Tek seferlik komut: `npm run bildirim:automation`  
Sıra: `planJobsForAllTenants()` → `processDueJobs()` → Prisma disconnect → exit code.

## Yeni servis: `whatsapp-automation-cron`

- **Cron:** `*/5 * * * *` (her 5 dakika)
- **Start / cron command:** `npm run bildirim:automation`
- Lisans reminder cron’una (`license:reminder`) dokunmayın; ayrı servis kalsın.
- MailCenter’a dokunulmaz.

## Zorunlu ortam değişkenleri

Bu cron servisinde en azından şunlar tanımlanmalı:

| Değişken | Not |
|---|---|
| `WHATSAPP_AUTOMATION_ENABLED=true` | Planlama + worker kapısı |
| `WHATSAPP_CLOUD_API_ENABLED=true` | Gerçek Cloud gönderim |
| `DATABASE_URL` | Aynı production DB |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | Tenant WhatsApp token çözümü |
| `WHATSAPP_GRAPH_API_VERSION` | Opsiyonel; yoksa varsayılan |
| Meta app kimlikleri (`WHATSAPP_APP_ID` / `META_APP_ID`, `WHATSAPP_APP_SECRET` / `META_APP_SECRET`) | Token/debug ve webhook imza yolları için backend ile aynı set |

Tenant WhatsApp bağlantı token’ları DB’de şifreli tutulur; cron’un web API ile **aynı encryption key** ve **aynı DATABASE_URL** kullanması gerekir.

## Davranış güvenceleri

- Sabit 10:00–20:00 ürün engeli **yok**; tahsilat kuralları büronun seçtiği sabit saatte (00:00–23:55) planlanır/gönderilir.
- Randevu hatırlatmaları: `randevu.baslangicAt − offsetDk` gerçek zamanında planlanır (ör. 08:30 − 60 dk = 07:30).
- İsteğe bağlı **Sessiz saatleri dikkate al**: açıksa sessiz dilime denk randevu mesajı randevudan sonraya itilmez, önceki aktif saate alınır.
- Önerilen aktif aralık (yeni tenant / UI): **09:00–20:00** (zorunlu değil).
- Aynı işlerin tekrarı: mevcut `idempotencyKey` + job lock; plan güncellemede bekleyen iş saati güncellenir / iptal+yeniden plan.
- Dry-run (yerel): `npm run bildirim:automation -- --dry-run` → salt okunur önizleme (DB yazmaz, Meta çağırmaz).

## Dry-run güvencesi

`npm run bildirim:automation -- --dry-run`:

- `planJobsForAllTenants()` **çağrılmaz**
- `processDueJobs()` **çağrılmaz**
- Yalnızca `previewPlanJobsForAllTenants()` (salt okunur SELECT)
- **DB yazmaz**, **Meta provider çağırmaz**

Canlı gönderim: bayraklar açıkken `npm run bildirim:automation` (dry-run olmadan).

