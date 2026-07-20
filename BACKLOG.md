# YieldFlow — Backlog

## Feature 4 — Connect an existing bank account (NOT built)

Let the user link a bank account they already own so the agent can (a) read
balances/transactions to auto-verify requirement progress and (b) actually
execute the funding + recall transfer legs a campaign plans.

**Why it's deferred:** Feature 5's cockpit already plans and approves the
funding/recall legs, but *executing* them needs a real connected account plus a
money-movement provider. Building that is a discrete chunk with external
dependencies (aggregator + ACH), so it's split out.

**Shape when built:**
- **Link flow:** Plaid Link (or manual routing/account entry) → write a
  `linked_account` row (`aggregator`, `aggregator_item_id`, `account_mask`,
  `routing_number` tokenized) + initial `account_balance_snapshot`. Vault the
  credentials via `user_credential_ref` (pointer only — never store secrets in
  the DB).
- **Balance/txn sync:** periodic pull → `account_balance_snapshot` +
  `transaction` rows; feed the direct-deposit classifier
  (`transaction.dd_classification`) that auto-fills
  `campaign_requirement_progress` + `requirement_evidence`.
- **Execution adapter:** implement `ExecutionAdapter` (see
  `src/lib/execution/adapter.ts`) backed by an ACH/RTP provider so approved
  `transfer_leg`s move from `approved` → `submitted` → `settled`. Bind each
  leg's `from_account_id` / `to_account_id` to real `linked_account`s.
- **Guardrails:** enforce `fdic_exposure` limits and per-account ACH
  daily/monthly caps (already modeled) before submitting legs; keep the
  `transfer_plan.approved_by_user_at` hard gate.

**Legal posture (unchanged):** advisory + assisted only. Account opening stays a
user-completed KYC handoff; YieldFlow never takes custody of funds. Wiring an ACH
provider must be done in a way that keeps YieldFlow outside money-transmitter
licensing (e.g. bank-initiated pushes/pulls on accounts the user owns, never
holding funds).

## Other modeled-but-unbuilt areas (from the schema)

- **Live crawler** (`liveWebProvider` in `src/lib/discovery/provider.ts`): fetch
  trackers/bank pages + LLM-extract to `DiscoveredOffer` (needs
  `ANTHROPIC_API_KEY`). Today discovery uses a curated snapshot.
- **DD classifier** (Domain E): probabilistic direct-deposit recognition from
  `ach_sec_code` / `ach_company_entry_description`, feeding the feasibility model.
- **Capital-days optimizer** (Domain G): constrained knapsack over capital-days
  subject to ACH throughput, ChexSystems velocity, and FDIC limits.
- **Payout/tax reconciliation** (Domain H): `bonus_payout`, `tax_lot` (1099-INT),
  `performance_period`.
- **Agent runs + approvals + audit** (Domain I).
