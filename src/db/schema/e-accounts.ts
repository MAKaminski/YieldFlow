import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { pk, timestamps } from "./_shared";
import { institution, product } from "./a-institution";
import { userProfile } from "./d-users";

// Domain E — Linked Accounts & Balances

export const linkedAccount = sqliteTable("linked_account", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  institutionId: text("institution_id")
    .notNull()
    .references(() => institution.id),
  productId: text("product_id").references(() => product.id),
  aggregator: text("aggregator", {
    enum: ["plaid", "mx", "finicity", "manual", "direct_api"],
  })
    .notNull()
    .default("manual"),
  aggregatorItemId: text("aggregator_item_id"),
  aggregatorAccountId: text("aggregator_account_id"),
  accountRole: text("account_role", {
    enum: ["base_hub", "bonus_target", "payroll_source", "parking", "external"],
  }).notNull(),
  accountMask: text("account_mask"), // last 4
  accountNumberToken: text("account_number_token"), // tokenized
  routingNumber: text("routing_number"),
  accountSubtype: text("account_subtype", {
    enum: ["checking", "savings", "mma", "cd"],
  }),
  openedAt: integer("opened_at", { mode: "timestamp" }),
  closedAt: integer("closed_at", { mode: "timestamp" }),
  status: text("status", {
    enum: ["pending_open", "open", "restricted", "closing", "closed"],
  })
    .notNull()
    .default("pending_open"),
  achDailyLimitCents: integer("ach_daily_limit_cents"),
  achMonthlyLimitCents: integer("ach_monthly_limit_cents"),
  supportsPush: integer("supports_push", { mode: "boolean" }).notNull().default(true),
  supportsPull: integer("supports_pull", { mode: "boolean" }).notNull().default(true),
  ...timestamps(),
});

export const accountBalanceSnapshot = sqliteTable("account_balance_snapshot", {
  id: pk(),
  linkedAccountId: text("linked_account_id")
    .notNull()
    .references(() => linkedAccount.id),
  asOf: integer("as_of", { mode: "timestamp" }).notNull(),
  currentCents: integer("current_cents"),
  availableCents: integer("available_cents"),
  source: text("source"),
  ...timestamps(),
});

export const transaction = sqliteTable("transaction", {
  id: pk(),
  linkedAccountId: text("linked_account_id")
    .notNull()
    .references(() => linkedAccount.id),
  aggregatorTransactionId: text("aggregator_transaction_id"),
  postedDate: integer("posted_date", { mode: "timestamp" }),
  authorizedDate: integer("authorized_date", { mode: "timestamp" }),
  amountCents: integer("amount_cents").notNull(), // signed
  direction: text("direction", { enum: ["credit", "debit"] }).notNull(),
  descriptionRaw: text("description_raw"),
  achSecCode: text("ach_sec_code"), // PPD / CCD / WEB — the key DD signal
  achCompanyName: text("ach_company_name"),
  achCompanyEntryDescription: text("ach_company_entry_description"), // "DIRECT DEP"
  counterpartyName: text("counterparty_name"),
  category: text("category", {
    enum: [
      "payroll",
      "transfer_in",
      "transfer_out",
      "interest",
      "bonus_payout",
      "fee",
      "other",
    ],
  })
    .notNull()
    .default("other"),
  isInternalTransfer: integer("is_internal_transfer", { mode: "boolean" })
    .notNull()
    .default(false),
  ddClassification: text("dd_classification", {
    enum: ["confirmed_dd", "likely_dd", "unlikely_dd", "not_dd"],
  }),
  ddConfidence: real("dd_confidence"),
  matchedTransferId: text("matched_transfer_id").references(
    (): AnySQLiteColumn => transaction.id,
  ),
  ...timestamps(),
});
