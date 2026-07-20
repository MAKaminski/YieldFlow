# YieldFlow

**Automated Deposit-Bonus Harvesting Agent** — discovers US bank sign-up bonus
offers, models their requirements as an executable AND/OR rules tree, computes
per-user eligibility + yield, and tracks "campaigns" to actually earn the
bonuses. Advisory-first: it never takes custody of funds.

The product thesis: a bank bonus is a *fixed dollar amount decoupled from
balance*, so the return is inversely proportional to how much capital you tie up
and for how long. The optimizer's objective is **most bonus dollars per
capital-day**, subject to ACH throughput, ChexSystems velocity, and FDIC limits.

The reference offer wired end-to-end in the seed is the Regions *LifeGreen
Preferred Checking* $400 bonus (+ a stackable Premium Money Market 4.15% APY
promo): $1,500 held 90 days for $400 ≈ **108% annualized** (~74% after tax).

## Stack

- **Next.js 15** (App Router) + **TypeScript** + **Tailwind CSS**
- **Drizzle ORM** on the **libSQL** driver (`@libsql/client`)
- **SQLite locally** (`file:local.db`) → **Turso** in production. libSQL *is*
  SQLite, so the same schema/driver works — but unlike a plain SQLite file, a
  Turso database persists writes on Vercel's serverless filesystem.
- **Zod** for API input validation

## Quick start (local — zero external services)

```bash
npm install
cp .env.example .env          # DATABASE_URL defaults to file:local.db
npm run db:generate           # generate SQL migration from the schema (already committed)
npm run db:migrate            # create local.db with all 37 tables
npm run db:seed               # load the Regions example end-to-end
npm run dev                   # http://localhost:3000
```

`npm run db:reset` wipes and rebuilds `local.db` from scratch.
`npm run db:discover` ingests the curated public-offer snapshot (additive) and
recomputes eligibility for the demo user — the "accumulate offers" step.

## How it works (discovery → eligibility → campaign)

1. **Discovery** (`src/lib/discovery/`): a source-agnostic pipeline normalizes
   offers into the schema (institution → product → offer → AND/OR requirement
   tree → disqualifiers → geo). `curatedProvider` holds a hand-verified snapshot
   of ~21 live US checking bonuses (Chase, SoFi, Capital One, PNC, Wells Fargo,
   Citi, TD, …), each stored with an `extractionConfidence` + `verificationStatus`
   + source link. `liveWebProvider` is the documented crawler seam (needs an LLM
   key). Run with `npm run db:discover` or `POST /api/discovery/run`.
2. **Eligibility** (`src/lib/eligibility.ts`): `evaluateEligibility` applies geo,
   existing-customer, prior-bonus, and ChexSystems-velocity rules, then computes
   the capital-days economics via `src/lib/yield.ts`. `recomputeEligibility`
   materializes `user_offer_eligibility` rows. The demo user is in **GA**, so
   out-of-footprint offers (Huntington, TD, KeyBank, …) are correctly excluded.
3. **Campaign cockpit** (Feature 5): click **Start campaign** on any eligible
   offer → `startCampaign` (`src/lib/orchestration.ts`) creates the campaign, a
   per-requirement progress tracker, an ordered task chain (open → fund → direct
   deposit → confirm → **recall funds**) with bank deep-links, and an
   **approval-gated** transfer plan (fund + end-of-period recall). Drive it at
   `/campaigns/[id]`.

### Advisory boundary (by design)

YieldFlow never takes custody of funds. Account opening is a deep-link **handoff**
(identity verification must be completed by the user), and real money movement
sits behind `transfer_plan.approved_by_user_at` and a stubbed
`ExecutionAdapter` (`src/lib/execution/adapter.ts`) — it plans and approves, but
executes nothing until a connected account (see `BACKLOG.md`, Feature 4) + an ACH
provider are wired. This keeps YieldFlow outside money-transmitter licensing and
the headless-KYC problem.

## Pages & API

| Route | What it shows |
|---|---|
| `/` | Offer pipeline ranked by risk-adjusted after-tax annualized yield |
| `/offers/[id]` | Requirement tree (AND/OR), disqualifiers, geo eligibility, economics |
| `/campaigns` | Campaigns with per-requirement progress vs. deadline & clawback date |
| `GET /api/offers` | Ranked offers as JSON |
| `GET /api/campaigns` | Campaigns + progress as JSON |
| `GET /api/eligibility?bonusCents=&capitalCents=&holdDays=&marginalRateBps=&ddDifficulty=` | Pure yield calculator |

Example:

```bash
curl "localhost:3000/api/eligibility?bonusCents=40000&capitalCents=150000&holdDays=90&marginalRateBps=3200&ddDifficulty=probabilistic"
# -> projectedAnnualizedYieldBps: 10815 (108.15%), projectedNetAfterTaxBps: 7354
```

## Data model

37 tables across 9 domains (A Institution/Product → I Agent/Compliance). See
[`ERD.md`](./ERD.md) for the full map and the Postgres→SQLite type translation.
Schema lives in `src/db/schema/`, one file per domain, barrel-exported from
`schema/index.ts`.

## Deploying to Vercel + Turso

Local dev needs nothing external. Production needs a Turso database because a
plain SQLite file does not persist writes on Vercel serverless.

1. **Create a Turso database** ([install the CLI](https://docs.turso.tech/cli/installation)):
   ```bash
   turso db create yieldflow
   turso db show yieldflow --url          # -> DATABASE_URL (libsql://…)
   turso db tokens create yieldflow       # -> DATABASE_AUTH_TOKEN
   ```
2. **Apply the schema to Turso** (one-off, from your machine — never in the
   Vercel build):
   ```bash
   DATABASE_URL="libsql://…" DATABASE_AUTH_TOKEN="…" npm run db:migrate
   DATABASE_URL="libsql://…" DATABASE_AUTH_TOKEN="…" npm run db:seed   # optional demo data
   ```
3. **Set the env vars in Vercel** (Project → Settings → Environment Variables):
   `DATABASE_URL` and `DATABASE_AUTH_TOKEN`.
4. **Deploy** — push to the repo (Vercel auto-detects Next.js) or `vercel --prod`.

### Environment variables

| Var | Local | Production |
|---|---|---|
| `DATABASE_URL` | `file:local.db` | `libsql://<db>-<org>.turso.io` |
| `DATABASE_AUTH_TOKEN` | *(empty)* | Turso token |

Secrets live in `.env` (gitignored); `.env.example` is the committed template.

## Scope & posture

Built **advisory-first with assisted execution**, deliberately outside
money-transmitter licensing and KYC-impersonation:

- **Auto:** offer discovery, extraction, eligibility, requirement tracking,
  deadline alerts, transfer planning.
- **One-click approved:** transfer legs between accounts the user already owns.
- **Assisted handoff:** account opening via deep link + credential-vault autofill.

This repo is the data model + read-only cockpit. The crawlers, aggregator
(Plaid) integration, DD classifier, and optimizer are modeled in the schema
(Domains B, E, G, I) and are the natural next build-out.
