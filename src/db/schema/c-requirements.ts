import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { pk, timestamps, jsonStringArray } from "./_shared";
import { offer } from "./b-offers";

// Domain C — Requirement Modeling (the executable AND/OR rules tree)

export const requirementGroup = sqliteTable("requirement_group", {
  id: pk(),
  offerId: text("offer_id")
    .notNull()
    .references(() => offer.id),
  parentGroupId: text("parent_group_id").references(
    (): AnySQLiteColumn => requirementGroup.id,
  ),
  logicOperator: text("logic_operator", { enum: ["ALL", "ANY", "N_OF"] }).notNull(),
  nRequired: integer("n_required"), // for N_OF
  sequence: integer("sequence").notNull().default(0),
  description: text("description"),
  ...timestamps(),
});

export const requirement = sqliteTable("requirement", {
  id: pk(),
  requirementGroupId: text("requirement_group_id")
    .notNull()
    .references(() => requirementGroup.id),
  requirementType: text("requirement_type", {
    enum: [
      "direct_deposit_cumulative",
      "direct_deposit_per_period",
      "min_balance_avg_daily",
      "min_balance_point_in_time",
      "new_money_deposit",
      "debit_transactions_count",
      "bill_pay_count",
      "enroll_online_banking",
      "enroll_estatements",
      "maintain_days",
      "no_early_closure",
      "branch_visit",
      "promo_code_entry",
    ],
  }).notNull(),
  targetAmountCents: integer("target_amount_cents"),
  targetCount: integer("target_count"),
  windowStartAnchor: text("window_start_anchor", {
    enum: ["account_open", "offer_start", "first_deposit", "statement_cycle"],
  }),
  windowDays: integer("window_days"),
  perPeriod: text("per_period", { enum: ["none", "monthly", "statement_cycle"] })
    .notNull()
    .default("none"),
  consecutivePeriods: integer("consecutive_periods"),
  balanceMeasure: text("balance_measure", {
    enum: ["avg_daily", "min_daily", "month_end", "any_day"],
  }),
  depositSourceConstraint: text("deposit_source_constraint", {
    enum: [
      "any_ach",
      "payroll_ach",
      "govt_benefit_ach",
      "external_transfer_ok",
      "no_internal_transfer",
    ],
  }),
  newMoneyLookbackDays: integer("new_money_lookback_days"),
  isBonusGating: integer("is_bonus_gating", { mode: "boolean" })
    .notNull()
    .default(true), // vs. fee-waiver only
  verificationDifficulty: text("verification_difficulty", {
    enum: ["deterministic", "probabilistic", "opaque"],
  })
    .notNull()
    .default("deterministic"),
  confidenceNotes: text("confidence_notes"),
  ...timestamps(),
});

export const disqualifier = sqliteTable("disqualifier", {
  id: pk(),
  offerId: text("offer_id")
    .notNull()
    .references(() => offer.id),
  disqualifierType: text("disqualifier_type", {
    enum: [
      "existing_customer",
      "closed_account_lookback",
      "prior_bonus_lookback",
      "state_excluded",
      "employee_of_bank",
      "business_entity",
      "age_minimum",
      "ssn_itin_required",
      "tax_withholding_status",
    ],
  }).notNull(),
  lookbackMonths: integer("lookback_months"),
  excludedStates: jsonStringArray("excluded_states"),
  includedStatesOnly: jsonStringArray("included_states_only"),
  detail: text("detail"),
  ...timestamps(),
});

export const geoEligibility = sqliteTable("geo_eligibility", {
  id: pk(),
  offerId: text("offer_id")
    .notNull()
    .references(() => offer.id),
  stateCode: text("state_code").notNull(),
  eligibility: text("eligibility", {
    enum: ["eligible", "ineligible", "unknown"],
  }).notNull(),
  zipWhitelist: jsonStringArray("zip_whitelist"),
  ...timestamps(),
});
