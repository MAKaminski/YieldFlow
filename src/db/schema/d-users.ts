import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { pk, timestamps, jsonStringArray } from "./_shared";
import { institution } from "./a-institution";
import { offer } from "./b-offers";

// Domain D — User, Identity & Eligibility

export const userProfile = sqliteTable("user_profile", {
  id: pk(),
  email: text("email").notNull(),
  phone: text("phone"),
  legalFirst: text("legal_first"),
  legalMiddle: text("legal_middle"),
  legalLast: text("legal_last"),
  dob: integer("dob", { mode: "timestamp" }),
  ssnToken: text("ssn_token"), // tokenized, never plaintext
  taxStatus: text("tax_status", {
    enum: ["us_person", "resident_alien", "nonresident_alien"],
  }),
  w9OnFile: integer("w9_on_file", { mode: "boolean" }).notNull().default(false),
  riskTolerance: text("risk_tolerance", {
    enum: ["conservative", "standard", "aggressive"],
  })
    .notNull()
    .default("standard"),
  maxOpenAccounts: integer("max_open_accounts"),
  kycStatus: text("kyc_status", {
    enum: ["unverified", "pending", "verified", "failed"],
  })
    .notNull()
    .default("unverified"),
  ...timestamps(),
});

export const userAddress = sqliteTable("user_address", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  line1: text("line1"),
  line2: text("line2"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),
  effectiveFrom: integer("effective_from", { mode: "timestamp" }),
  ...timestamps(),
});

export const userCredentialRef = sqliteTable("user_credential_ref", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  institutionId: text("institution_id")
    .notNull()
    .references(() => institution.id),
  vaultItemRef: text("vault_item_ref"), // 1Password / KMS pointer only
  mfaMethod: text("mfa_method", { enum: ["sms", "totp", "app_push", "email"] }),
  lastRotatedAt: integer("last_rotated_at", { mode: "timestamp" }),
  ...timestamps(),
});

export const chexsystemsEvent = sqliteTable("chexsystems_event", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  institutionId: text("institution_id").references(() => institution.id),
  eventType: text("event_type", {
    enum: ["inquiry", "account_open", "account_close", "denial", "reported_negative"],
  }).notNull(),
  eventDate: integer("event_date", { mode: "timestamp" }),
  source: text("source", { enum: ["self_reported", "chex_report", "inferred"] })
    .notNull()
    .default("self_reported"),
  ...timestamps(),
});

export const userOfferEligibility = sqliteTable("user_offer_eligibility", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  offerId: text("offer_id")
    .notNull()
    .references(() => offer.id),
  eligibilityStatus: text("eligibility_status", {
    enum: ["eligible", "ineligible", "needs_review", "expired"],
  }).notNull(),
  blockingDisqualifierIds: jsonStringArray("blocking_disqualifier_ids"),
  computedAt: integer("computed_at", { mode: "timestamp" }),
  expectedGrossBonusCents: integer("expected_gross_bonus_cents"),
  requiredCapitalCents: integer("required_capital_cents"),
  capitalDays: real("capital_days"), // capital × days — the core scarcity metric
  projectedAnnualizedYieldBps: integer("projected_annualized_yield_bps"),
  projectedNetAfterTaxBps: integer("projected_net_after_tax_bps"),
  feasibilityScore: real("feasibility_score"), // P(success)
  rankScore: real("rank_score"), // optimizer output
  ...timestamps(),
});
