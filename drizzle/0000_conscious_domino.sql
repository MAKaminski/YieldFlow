CREATE TABLE `institution` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`brand_name` text NOT NULL,
	`rssd_id` text,
	`fdic_cert_id` text,
	`primary_aba_routing` text,
	`charter_type` text NOT NULL,
	`partner_bank_id` text,
	`hq_state` text,
	`chexsystems_sensitivity` text DEFAULT 'unknown' NOT NULL,
	`early_closure_clawback_days` integer,
	`supports_plaid` integer DEFAULT false NOT NULL,
	`website_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`partner_bank_id`) REFERENCES `institution`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `institution_rssd_id_unique` ON `institution` (`rssd_id`);--> statement-breakpoint
CREATE TABLE `institution_footprint` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`state_code` text NOT NULL,
	`coverage_type` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`institution_id`) REFERENCES `institution`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `product` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`product_name` text NOT NULL,
	`product_type` text NOT NULL,
	`monthly_fee_cents` integer DEFAULT 0 NOT NULL,
	`fee_waiver_rule_id` text,
	`min_opening_deposit_cents` integer DEFAULT 0 NOT NULL,
	`standard_apy_bps` integer DEFAULT 0 NOT NULL,
	`is_interest_bearing` integer DEFAULT false NOT NULL,
	`withdrawal_limits_json` text,
	`account_opening_url` text,
	`requires_branch_visit` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`institution_id`) REFERENCES `institution`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rate_tier` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`min_balance_cents` integer DEFAULT 0 NOT NULL,
	`max_balance_cents` integer,
	`apy_bps` integer NOT NULL,
	`is_promotional` integer DEFAULT false NOT NULL,
	`effective_from` integer,
	`effective_to` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `offer` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`product_id` text,
	`offer_code` text,
	`title` text NOT NULL,
	`bonus_type` text NOT NULL,
	`bonus_amount_cents` integer,
	`bonus_apy_bps` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`offer_start_date` integer,
	`offer_end_date` integer,
	`deposit_period_start` integer,
	`deposit_period_end` integer,
	`requirement_window_days` integer,
	`payout_window_days` integer,
	`is_targeted` integer DEFAULT false NOT NULL,
	`targeting_channel` text,
	`new_money_required` integer DEFAULT false NOT NULL,
	`new_customer_required` integer DEFAULT false NOT NULL,
	`customer_lookback_months` integer,
	`stackable_with_offer_ids` text,
	`terms_url` text,
	`raw_document_id` text,
	`extraction_confidence` real,
	`verification_status` text DEFAULT 'unverified' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`institution_id`) REFERENCES `institution`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_document_id`) REFERENCES `offer_raw_document`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `offer_change_log` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_id` text NOT NULL,
	`field_name` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`detected_at` integer,
	`detected_by_run_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`offer_id`) REFERENCES `offer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`detected_by_run_id`) REFERENCES `offer_ingest_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `offer_ingest_run` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_source_id` text NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`status` text NOT NULL,
	`pages_fetched` integer,
	`offers_found` integer,
	`offers_new` integer,
	`offers_updated` integer,
	`error_detail` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`offer_source_id`) REFERENCES `offer_source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `offer_raw_document` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_ingest_run_id` text,
	`source_url` text,
	`content_hash` text,
	`raw_html` text,
	`extracted_text` text,
	`screenshot_uri` text,
	`ocr_text` text,
	`captured_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`offer_ingest_run_id`) REFERENCES `offer_ingest_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `offer_source` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_name` text NOT NULL,
	`base_url` text,
	`crawl_frequency_minutes` integer,
	`trust_score` real,
	`requires_targeted_mailer` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `disqualifier` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_id` text NOT NULL,
	`disqualifier_type` text NOT NULL,
	`lookback_months` integer,
	`excluded_states` text,
	`included_states_only` text,
	`detail` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`offer_id`) REFERENCES `offer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `geo_eligibility` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_id` text NOT NULL,
	`state_code` text NOT NULL,
	`eligibility` text NOT NULL,
	`zip_whitelist` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`offer_id`) REFERENCES `offer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `requirement` (
	`id` text PRIMARY KEY NOT NULL,
	`requirement_group_id` text NOT NULL,
	`requirement_type` text NOT NULL,
	`target_amount_cents` integer,
	`target_count` integer,
	`window_start_anchor` text,
	`window_days` integer,
	`per_period` text DEFAULT 'none' NOT NULL,
	`consecutive_periods` integer,
	`balance_measure` text,
	`deposit_source_constraint` text,
	`new_money_lookback_days` integer,
	`is_bonus_gating` integer DEFAULT true NOT NULL,
	`verification_difficulty` text DEFAULT 'deterministic' NOT NULL,
	`confidence_notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`requirement_group_id`) REFERENCES `requirement_group`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `requirement_group` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_id` text NOT NULL,
	`parent_group_id` text,
	`logic_operator` text NOT NULL,
	`n_required` integer,
	`sequence` integer DEFAULT 0 NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`offer_id`) REFERENCES `offer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_group_id`) REFERENCES `requirement_group`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chexsystems_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`institution_id` text,
	`event_type` text NOT NULL,
	`event_date` integer,
	`source` text DEFAULT 'self_reported' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`institution_id`) REFERENCES `institution`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_address` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`line1` text,
	`line2` text,
	`city` text,
	`state` text,
	`zip` text,
	`is_current` integer DEFAULT true NOT NULL,
	`effective_from` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_credential_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`institution_id` text NOT NULL,
	`vault_item_ref` text,
	`mfa_method` text,
	`last_rotated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`institution_id`) REFERENCES `institution`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_offer_eligibility` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`eligibility_status` text NOT NULL,
	`blocking_disqualifier_ids` text,
	`computed_at` integer,
	`expected_gross_bonus_cents` integer,
	`required_capital_cents` integer,
	`capital_days` real,
	`projected_annualized_yield_bps` integer,
	`projected_net_after_tax_bps` integer,
	`feasibility_score` real,
	`rank_score` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offer_id`) REFERENCES `offer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`legal_first` text,
	`legal_middle` text,
	`legal_last` text,
	`dob` integer,
	`ssn_token` text,
	`tax_status` text,
	`w9_on_file` integer DEFAULT false NOT NULL,
	`risk_tolerance` text DEFAULT 'standard' NOT NULL,
	`max_open_accounts` integer,
	`kyc_status` text DEFAULT 'unverified' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account_balance_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`linked_account_id` text NOT NULL,
	`as_of` integer NOT NULL,
	`current_cents` integer,
	`available_cents` integer,
	`source` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`linked_account_id`) REFERENCES `linked_account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `linked_account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`institution_id` text NOT NULL,
	`product_id` text,
	`aggregator` text DEFAULT 'manual' NOT NULL,
	`aggregator_item_id` text,
	`aggregator_account_id` text,
	`account_role` text NOT NULL,
	`account_mask` text,
	`account_number_token` text,
	`routing_number` text,
	`account_subtype` text,
	`opened_at` integer,
	`closed_at` integer,
	`status` text DEFAULT 'pending_open' NOT NULL,
	`ach_daily_limit_cents` integer,
	`ach_monthly_limit_cents` integer,
	`supports_push` integer DEFAULT true NOT NULL,
	`supports_pull` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`institution_id`) REFERENCES `institution`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`linked_account_id` text NOT NULL,
	`aggregator_transaction_id` text,
	`posted_date` integer,
	`authorized_date` integer,
	`amount_cents` integer NOT NULL,
	`direction` text NOT NULL,
	`description_raw` text,
	`ach_sec_code` text,
	`ach_company_name` text,
	`ach_company_entry_description` text,
	`counterparty_name` text,
	`category` text DEFAULT 'other' NOT NULL,
	`is_internal_transfer` integer DEFAULT false NOT NULL,
	`dd_classification` text,
	`dd_confidence` real,
	`matched_transfer_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`linked_account_id`) REFERENCES `linked_account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_transfer_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `campaign` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`linked_account_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`planned_start_date` integer,
	`account_opened_at` integer,
	`requirements_deadline` integer,
	`earliest_safe_close_date` integer,
	`planned_close_date` integer,
	`capital_committed_cents` integer,
	`expected_bonus_cents` integer,
	`actual_bonus_cents` integer,
	`total_fees_paid_cents` integer,
	`interest_earned_cents` integer,
	`net_profit_cents` integer,
	`realized_annualized_bps` integer,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offer_id`) REFERENCES `offer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_account_id`) REFERENCES `linked_account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `campaign_requirement_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`target_amount_cents` integer,
	`accrued_amount_cents` integer DEFAULT 0 NOT NULL,
	`target_count` integer,
	`accrued_count` integer DEFAULT 0 NOT NULL,
	`window_opens_at` integer,
	`window_closes_at` integer,
	`status` text DEFAULT 'not_started' NOT NULL,
	`confidence` real,
	`last_evaluated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `campaign_task` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`task_type` text NOT NULL,
	`automation_mode` text DEFAULT 'assisted_handoff' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`due_at` integer,
	`blocked_by_task_id` text,
	`assigned_agent_run_id` text,
	`user_action_url` text,
	`result_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocked_by_task_id`) REFERENCES `campaign_task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `requirement_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_requirement_progress_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`contribution_cents` integer,
	`match_rule` text,
	`match_confidence` real,
	`is_disputed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_requirement_progress_id`) REFERENCES `campaign_requirement_progress`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fdic_exposure` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`fdic_cert_id` text NOT NULL,
	`ownership_category` text,
	`as_of` integer,
	`aggregate_balance_cents` integer,
	`insured_limit_cents` integer,
	`excess_cents` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transfer_leg` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_plan_id` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`from_account_id` text,
	`to_account_id` text,
	`amount_cents` integer NOT NULL,
	`rail` text NOT NULL,
	`initiating_side` text NOT NULL,
	`purpose` text NOT NULL,
	`earliest_initiate_date` integer,
	`expected_settle_date` integer,
	`depends_on_leg_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`external_transfer_ref` text,
	`return_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`transfer_plan_id`) REFERENCES `transfer_plan`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_account_id`) REFERENCES `linked_account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `linked_account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depends_on_leg_id`) REFERENCES `transfer_leg`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transfer_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_date` integer,
	`objective` text NOT NULL,
	`total_capital_cents` integer,
	`solver_version` text,
	`solver_inputs_json` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_by_user_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bonus_payout` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`transaction_id` text,
	`expected_amount_cents` integer,
	`actual_amount_cents` integer,
	`expected_by_date` integer,
	`posted_date` integer,
	`variance_cents` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`escalation_status` text DEFAULT 'none' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `performance_period` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`avg_capital_deployed_cents` integer,
	`gross_bonus_cents` integer,
	`gross_interest_cents` integer,
	`fees_cents` integer,
	`tax_estimate_cents` integer,
	`net_cents` integer,
	`realized_annualized_bps` integer,
	`campaigns_completed` integer,
	`campaigns_failed` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tax_lot` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`institution_id` text,
	`tax_year` integer NOT NULL,
	`income_type` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`form_1099_int_received` integer DEFAULT false NOT NULL,
	`expected_marginal_rate_bps` integer,
	`estimated_tax_owed_cents` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`institution_id`) REFERENCES `institution`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_run_id` text NOT NULL,
	`subject_type` text,
	`subject_id` text,
	`decision` text,
	`rationale` text,
	`confidence` real,
	`alternatives_considered` text,
	`required_human_approval` integer DEFAULT false NOT NULL,
	`approved_by_user_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_run` (
	`id` text PRIMARY KEY NOT NULL,
	`run_type` text NOT NULL,
	`triggered_by` text NOT NULL,
	`model_name` text,
	`model_version` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`cost_cents` integer,
	`started_at` integer,
	`finished_at` integer,
	`status` text NOT NULL,
	`input_ref` text,
	`output_ref` text,
	`error_detail` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `approval_request` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`risk_level` text DEFAULT 'medium' NOT NULL,
	`presented_at` integer,
	`responded_at` integer,
	`decision` text,
	`channel` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`before_json` text,
	`after_json` text,
	`ip_address` text,
	`occurred_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `consent_record` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`consent_type` text NOT NULL,
	`version` text,
	`granted_at` integer,
	`revoked_at` integer,
	`ip_address` text,
	`document_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`campaign_id` text,
	`notification_type` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`sent_at` integer,
	`channel` text,
	`acknowledged_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE no action
);
