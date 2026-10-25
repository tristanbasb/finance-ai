CREATE TABLE `alert_log` (
	`key` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`message_id` integer
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`job` text PRIMARY KEY NOT NULL,
	`last_period` text NOT NULL,
	`last_run_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `messages_created_at_idx` ON `messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `messages_read_at_idx` ON `messages` (`read_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `prices` ADD `change_pct` real;