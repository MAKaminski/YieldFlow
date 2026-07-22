ALTER TABLE `offer` ADD `scout_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `offer` ADD `scout_fields` text;--> statement-breakpoint
ALTER TABLE `offer` ADD `scout_screenshot` text;--> statement-breakpoint
ALTER TABLE `offer` ADD `scouted_at` integer;