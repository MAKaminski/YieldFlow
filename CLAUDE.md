# CLAUDE.md — YieldFlow

Guidance for AI agents working in this repo. Companion docs:
[README.md](./README.md) (product + math), [ARCHITECTURE.md](./ARCHITECTURE.md)
(full system design), [AGENTS.md](./AGENTS.md) (the product agents + this same
guidance in machine-readable form), [agent/COVERAGE.md](./agent/COVERAGE.md)
(per-bank + per-pattern test matrix).

## What this is

An **Automated Deposit-Bonus Harvesting Agent**: discovers bank sign-up bonuses,
models their requirements as an executable AND/OR rules tree, computes per-user
eligibility + yield, and tracks campaigns to earn them. Advisory-first — never
takes custody of funds. Core metric: **bonus dollars per capital-day**. Targets
a net yield >100% and ~$3k/yr for a fully-eligible user; pricing is $20/mo + 20%
of bonuses earned.

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
src/lib/discovery/   offer discovery pipeline (types, ingest, provider, verify-links)
src/lib/discovery/verify-links.ts  auto-validates each offer's applicationUrl resolves
src/lib/discovery/sources.ts  public offer-list sources for the live extractor
src/lib/discovery/extract.ts  Anthropic-gated LLM extraction (needs ANTHROPIC_API_KEY)
src/app/go/[offerId]/route.ts  affiliate/click redirector (logs to audit_log, 302s out)
src/app/api/discovery/status/route.ts  discovery observability (runs, statuses, changes)
src/lib/eligibility.ts  evaluateEligibility + recomputeEligibility (Domain D)
src/lib/orchestration.ts  startCampaign → campaign + task chain + transfer plan
src/lib/execution/adapter.ts  ExecutionAdapter seam (stub only — no money moves)
src/db/discovery-data.ts  curated snapshot of ~21 live offers
src/db/discover.ts   npm run db:discover — ingest + recompute eligibility
src/db/verify-banks.ts  npm run db:verify-banks — per-bank entry-path check:
                     for every active offer, start a campaign + build the agent
                     job, assert it's well-formed (URL/channel/fields/steps).
src/lib/discovery/scout.ts  preview scout: real headless browser previews each
                     application page (npm run db:scout). Note: banks block
                     headless/datacenter browsers — expect ~all `blocked`; the
                     cockpit falls back to the verified link + instructions.
src/app/campaigns/actions.ts  server actions (the app's only write path)
src/lib/agent.ts     builds the desktop-agent job payload (field KEYS only, no
                     PII). AUTOFILL_FIELDS + IDENTITY_FIELDS (dateOfBirth, ssn);
                     identity keys are merged into autofillFields so DOB/SSN
                     auto-fill IF present in the local vault (opt-in).
src/app/api/agent/*  job + progress endpoints the local agent talks to
src/app/vault/       "Enter my details" page — builds & downloads the local
                     vault client-side (SSN/DOB never sent to the server).
agent/run.mjs        the desktop agent (single-file Node CLI, playwright-core):
                     drives the user's real Chrome, frame-aware prefill (resolves
                     <label for>/aria-labelledby, split/masked DOB+SSN, iframes),
                     guided click-through (driveSteps), always STOPS at identity.
agent/test/          automated headless harness (drive.test.mjs + fixtures) that
                     runs the real driveSteps against fake bank flows — 60 asserts.
agent/COVERAGE.md    per-bank + per-pattern coverage matrix.
agent/desktop/       OPTIONAL Tauri wrapper (yieldflow:// launch + signed .exe).
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
npm run db:generate      # after ANY schema change → regenerates ./drizzle SQL
npm run db:migrate       # apply to the DATABASE_URL target
npm run db:seed          # reload demo data
npm run db:reset         # wipe local.db + migrate + seed
npm run db:discover      # ingest live offer set + recompute eligibility
npm run db:verify-banks  # 18/18 bank entry paths (needs reset+discover first)
npm run build            # must pass before committing (Vercel parity)
cd agent && npm test     # 60 agent-logic assertions (needs a Chromium binary)
```

**After changing `src/db/schema/`, always `npm run db:generate` and commit the
new `drizzle/*.sql`.** Migrations are never run in the Vercel build.

**Before committing agent changes**, run `cd agent && npm test` (the click-through
harness) — and when a real bank exposes a new DOM quirk, add a fixture +
assertion so it becomes a permanent regression test (this is how the harness grew
27 → 60). See AGENTS.md § "Adding coverage for a new real-bank DOM quirk".

## Not built yet (modeled in schema, natural next steps)

Crawlers (Domain B), Plaid aggregation + DD classifier (Domain E), the
capital-days optimizer and transfer execution (Domain G), payout/tax
reconciliation (Domain H), agent runs + approvals (Domain I).
