import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { pk, timestamps, jsonStringArray } from "./_shared";
import { institution, product } from "./a-institution";

// Domain B — Offer Discovery & Normalization

export const offerSource = sqliteTable("offer_source", {
  id: pk(),
  sourceType: text("source_type", {
    enum: [
      "direct_mail",
      "bank_website",
      "aggregator",
      "affiliate_feed",
      "email",
      "reddit",
      "rss",
    ],
  }).notNull(),
  sourceName: text("source_name").notNull(),
  baseUrl: text("base_url"),
  crawlFrequencyMinutes: integer("crawl_frequency_minutes"),
  trustScore: real("trust_score"), // 0..1, weights conflicting extractions
  requiresTargetedMailer: integer("requires_targeted_mailer", { mode: "boolean" })
    .notNull()
    .default(false),
  ...timestamps(),
});

export const offerIngestRun = sqliteTable("offer_ingest_run", {
  id: pk(),
  offerSourceId: text("offer_source_id")
    .notNull()
    .references(() => offerSource.id),
  startedAt: integer("started_at", { mode: "timestamp" }),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  status: text("status", { enum: ["success", "partial", "failed"] }).notNull(),
  pagesFetched: integer("pages_fetched"),
  offersFound: integer("offers_found"),
  offersNew: integer("offers_new"),
  offersUpdated: integer("offers_updated"),
  errorDetail: text("error_detail"),
  ...timestamps(),
});

export const offerRawDocument = sqliteTable("offer_raw_document", {
  id: pk(),
  offerIngestRunId: text("offer_ingest_run_id").references(() => offerIngestRun.id),
  sourceUrl: text("source_url"),
  contentHash: text("content_hash"), // sha256, dedup key
  rawHtml: text("raw_html"),
  extractedText: text("extracted_text"),
  screenshotUri: text("screenshot_uri"),
  ocrText: text("ocr_text"), // for mailer photos
  capturedAt: integer("captured_at", { mode: "timestamp" }),
  ...timestamps(),
});

export const offer = sqliteTable("offer", {
  id: pk(),
  institutionId: text("institution_id")
    .notNull()
    .references(() => institution.id),
  productId: text("product_id").references(() => product.id),
  offerCode: text("offer_code"),
  title: text("title").notNull(),
  bonusType: text("bonus_type", {
    enum: ["cash", "promo_apy", "points", "gift_card", "rate_boost"],
  }).notNull(),
  bonusAmountCents: integer("bonus_amount_cents"),
  bonusApyBps: integer("bonus_apy_bps"),
  currency: text("currency").notNull().default("USD"),
  offerStartDate: integer("offer_start_date", { mode: "timestamp" }),
  offerEndDate: integer("offer_end_date", { mode: "timestamp" }),
  depositPeriodStart: integer("deposit_period_start", { mode: "timestamp" }),
  depositPeriodEnd: integer("deposit_period_end", { mode: "timestamp" }),
  requirementWindowDays: integer("requirement_window_days"),
  payoutWindowDays: integer("payout_window_days"),
  isTargeted: integer("is_targeted", { mode: "boolean" }).notNull().default(false),
  targetingChannel: text("targeting_channel", {
    enum: ["mail", "email", "in_app", "public"],
  }),
  newMoneyRequired: integer("new_money_required", { mode: "boolean" })
    .notNull()
    .default(false),
  newCustomerRequired: integer("new_customer_required", { mode: "boolean" })
    .notNull()
    .default(false),
  customerLookbackMonths: integer("customer_lookback_months"),
  stackableWithOfferIds: jsonStringArray("stackable_with_offer_ids"),
  termsUrl: text("terms_url"),
  rawDocumentId: text("raw_document_id").references(() => offerRawDocument.id),
  extractionConfidence: real("extraction_confidence"),
  verificationStatus: text("verification_status", {
    enum: ["unverified", "llm_verified", "human_verified", "disputed"],
  })
    .notNull()
    .default("unverified"),
  status: text("status", {
    enum: ["active", "expired", "pulled", "superseded"],
  })
    .notNull()
    .default("active"),
  ...timestamps(),
});

export const offerChangeLog = sqliteTable("offer_change_log", {
  id: pk(),
  offerId: text("offer_id")
    .notNull()
    .references(() => offer.id),
  fieldName: text("field_name").notNull(),
  oldValue: text("old_value", { mode: "json" }).$type<unknown>(),
  newValue: text("new_value", { mode: "json" }).$type<unknown>(),
  detectedAt: integer("detected_at", { mode: "timestamp" }),
  detectedByRunId: text("detected_by_run_id").references(() => offerIngestRun.id),
  ...timestamps(),
});
