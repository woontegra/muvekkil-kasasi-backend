# Migration: tenant_finans_kalemi

**Status:** SQL prepared, **not applied** (requires explicit approval before `prisma migrate deploy` on Railway).

## File
`prisma/migrations/20260914120000_tenant_finans_kalemi/migration.sql`

## What it does (additive)
1. Creates enum `FinansKalemTuru` (`GELIR` | `GIDER`)
2. Creates table `tenant_finans_kalemi` with tenant isolation, soft-archive, system flag, order
3. Unique `(tenant_id, tur, normalize_ad)` — case/trim-insensitive duplicate guard via `normalize_ad`
4. Partial unique `(tenant_id, kod) WHERE kod IS NOT NULL` for system codes
5. Adds nullable `kalem_id` FK on `ofis_kasa_hareketi` and `kasa_hareketi`
6. **Does not** rewrite existing `kategori` / `masraf_turu` text or amounts

## Data impact
- Zero change to historical movement category snapshots
- Empty kalem table until bootstrap/backfill runs
- New tenants get seeds in `provisionTenantWithOwner`
- Existing tenants: run `npx tsx src/finansKalemi/backfillFinansKalemleri.ts` **only after approval** (idempotent, creates rows only)

## Apply (after approval)
```bash
cd muvekkil-kasasi-backend
npx prisma migrate deploy
npx tsx src/finansKalemi/backfillFinansKalemleri.ts
```
