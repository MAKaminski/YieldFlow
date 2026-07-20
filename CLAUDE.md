# CLAUDE.md — YieldFlow

Guidance for AI agents working in this repo.

## What this is

An **Automated Deposit-Bonus Harvesting Agent**: discovers bank sign-up bonuses,
models their requirements as an executable AND/OR rules tree, computes per-user
eligibility + yield, and tracks campaigns to earn them. Advisory-first — never
takes custody of funds. Core metric: **bonus dollars per capital-day**.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind
- Drizzle ORM on libSQL (`@libsql/client`) — SQLite locally (`file:local.db`),
  Turso in production. Same driver, switched by `DATABASE_URL`.

## Layout

```
src/db/schema/*.ts   37 tables, one file per domain (a-…i), barrel index.ts
src/db/index.ts      libSQL client + drizzle() singleton (cached on globalThis)
src/db/migrate.ts    applies ./drizzle migrations (run out-of-band, never in build)
src/db/seed.ts       Regions example end-to-end; idempotent (clear then insert)
src/lib/yield.ts     pure economics: capitalDays, annualized/after-tax bps, feasibility
src/lib/queries.ts   read-only Drizzle queries shared by pages + API
src/lib/discovery/   offer discovery pipeline (types, ingest, provider)
src/lib/eligibility.ts  evaluateEligibility + recomputeEligibility (Domain D)
src/lib/orchestration.ts  startCampaign → campaign + task chain + transfer plan
src/lib/execution/adapter.ts  ExecutionAdapter seam (stub only — no money moves)
src/db/discovery-data.ts  curated snapshot of ~21 live offers
src/db/discover.ts   npm run db:discover — ingest + recompute eligibility
src/app/campaigns/actions.ts  server actions (the app's only write path)
src/app/…            App Router pages (server components) + /api route handlers
```

## Conventions

- **Money in integer cents; rates in basis points** (1% = 100 bps). Never floats
  for money. Use `centsToUsd` / `bpsToPercentString` from `src/lib/yield.ts`.
- **Postgres→SQLite types:** use the helpers in `schema/_shared.ts` (`pk()`,
  `timestamps()`, `jsonStringArray()`). Enums = `text(..., { enum: [...] })`.
  Arrays/jsonb = `{ mode: "json" }`. Self-ref FKs = `AnySQLiteColumn`.
- **Schema modules stay acyclic.** A few cross-domain links (product→requirement,
  campaign_task→agent_run, notification→campaign) are plain text pointers, not
  hard FKs, to avoid import cycles. Keep it that way.
- Pages that read the DB set `export const dynamic = "force-dynamic"` so they
  aren't statically prerendered at build (no DB at build time).

## Workflow

```bash
npm run db:generate   # after ANY schema change → regenerates ./drizzle SQL
npm run db:migrate    # apply to the DATABASE_URL target
npm run db:seed       # reload demo data
npm run db:reset      # wipe local.db + migrate + seed
npm run build         # must pass before committing (Vercel parity)
```

**After changing `src/db/schema/`, always `npm run db:generate` and commit the
new `drizzle/*.sql`.** Migrations are never run in the Vercel build.

## Not built yet (modeled in schema, natural next steps)

Crawlers (Domain B), Plaid aggregation + DD classifier (Domain E), the
capital-days optimizer and transfer execution (Domain G), payout/tax
reconciliation (Domain H), agent runs + approvals (Domain I).
