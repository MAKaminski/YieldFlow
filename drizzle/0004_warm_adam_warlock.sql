CREATE TABLE `feature_flag` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`label` text,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_flag_key_unique` ON `feature_flag` (`key`);--> statement-breakpoint
ALTER TABLE `offer` ADD `audience` text DEFAULT 'consumer' NOT NULL;