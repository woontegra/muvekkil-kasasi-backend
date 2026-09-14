# Migration: vekalet_ucreti_guvenli_iptal

**Status:** Prepared — **do not apply** without explicit approval (`prisma migrate deploy`).

## Effect
- Adds `VekaletUcreti.durum` / soft-delete columns (no hard delete of fee rows)
- Replaces global `dosya_id` unique with partial unique **where durum=AKTIF** so a new fee can be created after cancel
- Adds ödeme `makbuz_durumu` + `iptal_*` (makbuz number retained)
- Does **not** UPDATE/DELETE historical amounts, FX snapshots, or ofis/kasa money columns in SQL

## Apply (after approval)
```bash
npx prisma migrate deploy
```
