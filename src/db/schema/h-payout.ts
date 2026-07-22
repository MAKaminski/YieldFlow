import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { pk, timestamps } from "./_shared";
import { userProfile } from "./d-users";
import { institution } from "./a-institution";
import { campaign } from "./f-campaigns";
import { transaction } from "./e-accounts";

// Domain H — Payout, Tax & Performance

export const bonusPayout = sqliteTable("bonus_payout", {
  id: pk(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaign.id),
  transactionId: text("transaction_id").references(() => transaction.id), // detected credit
  expectedAmountCents: integer("expected_amount_cents"),
  actualAmountCents: integer("actual_amount_cents"),
  expectedByDate: integer("expected_by_date", { mode: "timestamp" }),
  postedDate: integer("posted_date", { mode: "timestamp" }),
  varianceCents: integer("variance_cents"),
  status: text("status", {
    enum: ["pending", "posted", "short_paid", "not_received", "clawed_back"],
  })
    .notNull()
    .default("pending"),
  escalationStatus: text("escalation_status", {
    enum: ["none", "contacted_bank", "cfpb_complaint", "resolved"],
  })
    .notNull()
    .default("none"),
  ...timestamps(),
});

export const taxLot = sqliteTable("tax_lot", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  institutionId: text("institution_id").references(() => institution.id),
  taxYear: integer("tax_year").notNull(),
  incomeType: text("income_type", {
    enum: ["bonus_interest", "interest"],
  }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  form1099IntReceived: integer("form_1099_int_received", { mode: "boolean" })
    .notNull()
    .default(false),
  expectedMarginalRateBps: integer("expected_marginal_rate_bps"),
  estimatedTaxOwedCents: integer("estimated_tax_owed_cents"),
  ...timestamps(),
});

export const performancePeriod = sqliteTable("performance_period", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  periodStart: integer("period_start", { mode: "timestamp" }),
  periodEnd: integer("period_end", { mode: "timestamp" }),
  avgCapitalDeployedCents: integer("avg_capital_deployed_cents"),
  grossBonusCents: integer("gross_bonus_cents"),
  grossInterestCents: integer("gross_interest_cents"),
  feesCents: integer("fees_cents"),
  taxEstimateCents: integer("tax_estimate_cents"),
  netCents: integer("net_cents"),
  realizedAnnualizedBps: integer("realized_annualized_bps"),
  campaignsCompleted: integer("campaigns_completed"),
  campaignsFailed: integer("campaigns_failed"),
  ...timestamps(),
});
