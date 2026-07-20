import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { pk, timestamps } from "./_shared";
import { userProfile } from "./d-users";
import { linkedAccount } from "./e-accounts";

// Domain G — Money Movement

export const transferPlan = sqliteTable("transfer_plan", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  planDate: integer("plan_date", { mode: "timestamp" }),
  objective: text("objective", {
    enum: [
      "maximize_bonus_yield",
      "maximize_apy",
      "maintain_fdic_limits",
      "wind_down",
    ],
  }).notNull(),
  totalCapitalCents: integer("total_capital_cents"),
  solverVersion: text("solver_version"),
  solverInputsJson: text("solver_inputs_json", { mode: "json" }).$type<
    Record<string, unknown>
  >(),
  status: text("status", {
    enum: ["draft", "awaiting_approval", "approved", "executing", "complete", "cancelled"],
  })
    .notNull()
    .default("draft"),
  // Hard gate — advisory-only by default.
  approvedByUserAt: integer("approved_by_user_at", { mode: "timestamp" }),
  ...timestamps(),
});

export const transferLeg = sqliteTable("transfer_leg", {
  id: pk(),
  transferPlanId: text("transfer_plan_id")
    .notNull()
    .references(() => transferPlan.id),
  sequence: integer("sequence").notNull().default(0),
  fromAccountId: text("from_account_id").references(() => linkedAccount.id),
  toAccountId: text("to_account_id").references(() => linkedAccount.id),
  amountCents: integer("amount_cents").notNull(),
  rail: text("rail", {
    enum: ["ach_standard", "ach_same_day", "wire", "rtp", "fednow", "internal"],
  }).notNull(),
  initiatingSide: text("initiating_side", {
    enum: ["push_from_source", "pull_from_destination"],
  }).notNull(),
  purpose: text("purpose", {
    enum: [
      "fund_new_account",
      "satisfy_dd",
      "satisfy_min_balance",
      "new_money_seed",
      "sweep_back_to_base",
      "wind_down",
    ],
  }).notNull(),
  earliestInitiateDate: integer("earliest_initiate_date", { mode: "timestamp" }),
  expectedSettleDate: integer("expected_settle_date", { mode: "timestamp" }),
  dependsOnLegId: text("depends_on_leg_id").references(
    (): AnySQLiteColumn => transferLeg.id,
  ),
  status: text("status", {
    enum: ["planned", "approved", "submitted", "in_transit", "settled", "returned", "cancelled"],
  })
    .notNull()
    .default("planned"),
  externalTransferRef: text("external_transfer_ref"),
  returnCode: text("return_code"), // R01, R03…
  ...timestamps(),
});

export const fdicExposure = sqliteTable("fdic_exposure", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  fdicCertId: text("fdic_cert_id").notNull(),
  ownershipCategory: text("ownership_category"),
  asOf: integer("as_of", { mode: "timestamp" }),
  aggregateBalanceCents: integer("aggregate_balance_cents"),
  insuredLimitCents: integer("insured_limit_cents"),
  excessCents: integer("excess_cents"),
  ...timestamps(),
});
