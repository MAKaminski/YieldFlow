import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { pk, timestamps } from "./_shared";

// Domain A — Institution & Product Reference

export const institution = sqliteTable("institution", {
  id: pk(),
  legalName: text("legal_name").notNull(),
  brandName: text("brand_name").notNull(),
  rssdId: text("rssd_id").unique(),
  fdicCertId: text("fdic_cert_id"),
  primaryAbaRouting: text("primary_aba_routing"),
  charterType: text("charter_type", {
    enum: ["national_bank", "state_bank", "credit_union", "thrift", "fintech_partner"],
  }).notNull(),
  // Neobanks riding a sponsor bank — self-ref, critical for FDIC dedup.
  partnerBankId: text("partner_bank_id").references(
    (): AnySQLiteColumn => institution.id,
  ),
  hqState: text("hq_state"),
  chexsystemsSensitivity: text("chexsystems_sensitivity", {
    enum: ["none", "moderate", "strict", "unknown"],
  })
    .notNull()
    .default("unknown"),
  earlyClosureClawbackDays: integer("early_closure_clawback_days"),
  supportsPlaid: integer("supports_plaid", { mode: "boolean" }).notNull().default(false),
  websiteUrl: text("website_url"),
  status: text("status", { enum: ["active", "merged", "defunct"] })
    .notNull()
    .default("active"),
  ...timestamps(),
});

export const institutionFootprint = sqliteTable("institution_footprint", {
  id: pk(),
  institutionId: text("institution_id")
    .notNull()
    .references(() => institution.id),
  stateCode: text("state_code").notNull(),
  coverageType: text("coverage_type", {
    enum: ["branch", "online_only", "excluded"],
  }).notNull(),
  ...timestamps(),
});

export const product = sqliteTable("product", {
  id: pk(),
  institutionId: text("institution_id")
    .notNull()
    .references(() => institution.id),
  productName: text("product_name").notNull(),
  productType: text("product_type", {
    enum: [
      "checking",
      "savings",
      "money_market",
      "cd",
      "ira",
      "brokerage",
      "business_checking",
    ],
  }).notNull(),
  monthlyFeeCents: integer("monthly_fee_cents").notNull().default(0),
  // Conceptually references a requirement_group (Domain C). Not enforced as a
  // cross-domain FK to keep schema modules acyclic.
  feeWaiverRuleId: text("fee_waiver_rule_id"),
  minOpeningDepositCents: integer("min_opening_deposit_cents").notNull().default(0),
  standardApyBps: integer("standard_apy_bps").notNull().default(0),
  isInterestBearing: integer("is_interest_bearing", { mode: "boolean" })
    .notNull()
    .default(false),
  withdrawalLimitsJson: text("withdrawal_limits_json", { mode: "json" }).$type<
    Record<string, unknown>
  >(),
  accountOpeningUrl: text("account_opening_url"),
  requiresBranchVisit: integer("requires_branch_visit", { mode: "boolean" })
    .notNull()
    .default(false),
  ...timestamps(),
});

export const rateTier = sqliteTable("rate_tier", {
  id: pk(),
  productId: text("product_id")
    .notNull()
    .references(() => product.id),
  minBalanceCents: integer("min_balance_cents").notNull().default(0),
  maxBalanceCents: integer("max_balance_cents"), // null = unbounded
  apyBps: integer("apy_bps").notNull(),
  isPromotional: integer("is_promotional", { mode: "boolean" })
    .notNull()
    .default(false),
  effectiveFrom: integer("effective_from", { mode: "timestamp" }),
  effectiveTo: integer("effective_to", { mode: "timestamp" }),
  ...timestamps(),
});
