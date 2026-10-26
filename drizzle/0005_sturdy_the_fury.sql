CREATE TABLE `recurring` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`amount` integer NOT NULL,
	`category_id` integer,
	`account_id` integer NOT NULL,
	`frequency` text NOT NULL,
	`anchor_month` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `recurring_payments` (
	`recurring_id` integer NOT NULL,
	`period` text NOT NULL,
	`transaction_id` integer,
	`skipped` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`recurring_id`, `period`),
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
