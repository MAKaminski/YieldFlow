import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { pk, timestamps } from "./_shared";
import { userProfile } from "./d-users";

// Domain I — Agent Execution, Compliance & Audit

export const agentRun = sqliteTable("agent_run", {
  id: pk(),
  runType: text("run_type", {
    enum: [
      "offer_crawl",
      "offer_extract",
      "eligibility_recompute",
      "progress_evaluate",
      "transfer_plan",
      "task_execute",
      "payout_reconcile",
    ],
  }).notNull(),
  triggeredBy: text("triggered_by", {
    enum: ["schedule", "user", "webhook", "retry"],
  }).notNull(),
  modelName: text("model_name"),
  modelVersion: text("model_version"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  costCents: integer("cost_cents"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  status: text("status", { enum: ["success", "partial", "failed"] }).notNull(),
  inputRef: text("input_ref", { mode: "json" }).$type<Record<string, unknown>>(),
  outputRef: text("output_ref", { mode: "json" }).$type<Record<string, unknown>>(),
  errorDetail: text("error_detail"),
  ...timestamps(),
});

export const agentDecision = sqliteTable("agent_decision", {
  id: pk(),
  agentRunId: text("agent_run_id")
    .notNull()
    .references(() => agentRun.id),
  subjectType: text("subject_type"),
  subjectId: text("subject_id"),
  decision: text("decision"),
  rationale: text("rationale"),
  confidence: real("confidence"),
  alternativesConsidered: text("alternatives_considered", { mode: "json" }).$type<
    unknown[]
  >(),
  requiredHumanApproval: integer("required_human_approval", { mode: "boolean" })
    .notNull()
    .default(false),
  approvedByUserAt: integer("approved_by_user_at", { mode: "timestamp" }),
  ...timestamps(),
});

export const approvalRequest = sqliteTable("approval_request", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  subjectType: text("subject_type", {
    enum: ["transfer_plan", "campaign_task", "account_close"],
  }).notNull(),
  subjectId: text("subject_id").notNull(),
  riskLevel: text("risk_level", { enum: ["low", "medium", "high"] })
    .notNull()
    .default("medium"),
  presentedAt: integer("presented_at", { mode: "timestamp" }),
  respondedAt: integer("responded_at", { mode: "timestamp" }),
  decision: text("decision", { enum: ["approved", "rejected", "deferred"] }),
  channel: text("channel"),
  ...timestamps(),
});

export const notification = sqliteTable("notification", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  // References campaign (Domain F); plain pointer to keep schema modules acyclic.
  campaignId: text("campaign_id"),
  notificationType: text("notification_type", {
    enum: [
      "deadline_warning",
      "requirement_at_risk",
      "bonus_posted",
      "offer_expiring",
      "action_required",
    ],
  }).notNull(),
  severity: text("severity", { enum: ["info", "warning", "critical"] })
    .notNull()
    .default("info"),
  sentAt: integer("sent_at", { mode: "timestamp" }),
  channel: text("channel"),
  acknowledgedAt: integer("acknowledged_at", { mode: "timestamp" }),
  ...timestamps(),
});

export const auditLog = sqliteTable("audit_log", {
  id: pk(),
  actorType: text("actor_type", { enum: ["user", "agent", "system"] }).notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  beforeJson: text("before_json", { mode: "json" }).$type<Record<string, unknown>>(),
  afterJson: text("after_json", { mode: "json" }).$type<Record<string, unknown>>(),
  ipAddress: text("ip_address"),
  occurredAt: integer("occurred_at", { mode: "timestamp" }),
  ...timestamps(),
});

export const consentRecord = sqliteTable("consent_record", {
  id: pk(),
  userId: text("user_id")
    .notNull()
    .references(() => userProfile.id),
  consentType: text("consent_type", {
    enum: ["data_aggregation", "transfer_authorization", "tos_acceptance", "e_sign"],
  }).notNull(),
  version: text("version"),
  grantedAt: integer("granted_at", { mode: "timestamp" }),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  ipAddress: text("ip_address"),
  documentHash: text("document_hash"),
  ...timestamps(),
});
