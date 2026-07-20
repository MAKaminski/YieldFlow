import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { pk, timestamps } from "./_shared";
import { userProfile } from "./d-users";
import { offer } from "./b-offers";
import { requirement } from "./c-requirements";
import { linkedAccount, transaction } from "./e-accounts";

// Domain F — Campaign Orchestration (the agent's working memory)

export const campaign = sqliteTable("campaign", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  offerId: text("offer_id")
    .notNull()
    .references(() => offer.id),
  linkedAccountId: text("linked_account_id").references(() => linkedAccount.id),
  status: text("status", {
    enum: [
      "planned",
      "applying",
      "open_pending_funding",
      "in_progress",
      "requirements_met",
      "awaiting_payout",
      "paid",
      "failed",
      "abandoned",
      "clawed_back",
    ],
  })
    .notNull()
    .default("planned"),
  plannedStartDate: integer("planned_start_date", { mode: "timestamp" }),
  accountOpenedAt: integer("account_opened_at", { mode: "timestamp" }),
  requirementsDeadline: integer("requirements_deadline", { mode: "timestamp" }),
  earliestSafeCloseDate: integer("earliest_safe_close_date", { mode: "timestamp" }),
  plannedCloseDate: integer("planned_close_date", { mode: "timestamp" }),
  capitalCommittedCents: integer("capital_committed_cents"),
  expectedBonusCents: integer("expected_bonus_cents"),
  actualBonusCents: integer("actual_bonus_cents"),
  totalFeesPaidCents: integer("total_fees_paid_cents"),
  interestEarnedCents: integer("interest_earned_cents"),
  netProfitCents: integer("net_profit_cents"),
  realizedAnnualizedBps: integer("realized_annualized_bps"),
  failureReason: text("failure_reason", {
    enum: [
      "dd_not_recognized",
      "deadline_missed",
      "denied_at_application",
      "offer_pulled",
      "balance_shortfall",
      "user_abandoned",
      "clawback",
    ],
  }),
  ...timestamps(),
});

export const campaignRequirementProgress = sqliteTable("campaign_requirement_progress", {
  id: pk(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaign.id),
  requirementId: text("requirement_id")
    .notNull()
    .references(() => requirement.id),
  targetAmountCents: integer("target_amount_cents"),
  accruedAmountCents: integer("accrued_amount_cents").notNull().default(0),
  targetCount: integer("target_count"),
  accruedCount: integer("accrued_count").notNull().default(0),
  windowOpensAt: integer("window_opens_at", { mode: "timestamp" }),
  windowClosesAt: integer("window_closes_at", { mode: "timestamp" }),
  status: text("status", {
    enum: ["not_started", "in_progress", "satisfied", "at_risk", "failed"],
  })
    .notNull()
    .default("not_started"),
  confidence: real("confidence"), // probabilistic for opaque DD rules
  lastEvaluatedAt: integer("last_evaluated_at", { mode: "timestamp" }),
  ...timestamps(),
});

export const requirementEvidence = sqliteTable("requirement_evidence", {
  id: pk(),
  campaignRequirementProgressId: text("campaign_requirement_progress_id")
    .notNull()
    .references(() => campaignRequirementProgress.id),
  transactionId: text("transaction_id")
    .notNull()
    .references(() => transaction.id),
  contributionCents: integer("contribution_cents"),
  matchRule: text("match_rule"),
  matchConfidence: real("match_confidence"),
  isDisputed: integer("is_disputed", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

export const campaignTask = sqliteTable("campaign_task", {
  id: pk(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaign.id),
  taskType: text("task_type", {
    enum: [
      "open_account",
      "verify_micro_deposits",
      "enroll_estatements",
      "initiate_transfer",
      "redirect_direct_deposit",
      "schedule_debit_txns",
      "confirm_bonus_posted",
      "close_account",
      "file_complaint",
    ],
  }).notNull(),
  automationMode: text("automation_mode", {
    enum: ["fully_auto", "assisted_handoff", "manual_only"],
  })
    .notNull()
    .default("assisted_handoff"),
  status: text("status", {
    enum: ["pending", "blocked", "awaiting_user", "in_flight", "done", "failed"],
  })
    .notNull()
    .default("pending"),
  dueAt: integer("due_at", { mode: "timestamp" }),
  blockedByTaskId: text("blocked_by_task_id").references(
    (): AnySQLiteColumn => campaignTask.id,
  ),
  // References agent_run (Domain I); kept as a plain pointer to keep schema
  // modules acyclic.
  assignedAgentRunId: text("assigned_agent_run_id"),
  userActionUrl: text("user_action_url"), // deep link for handoff
  resultJson: text("result_json", { mode: "json" }).$type<Record<string, unknown>>(),
  ...timestamps(),
});
