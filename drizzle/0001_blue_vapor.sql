ALTER TABLE `offer` ADD `application_url` text;--> statement-breakpoint
ALTER TABLE `offer` ADD `application_channel` text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `offer` ADD `application_url_verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `offer` ADD `signup_notes` text;