CREATE TABLE `news` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`title` text NOT NULL,
	`title_fr` text,
	`publisher` text NOT NULL,
	`link` text NOT NULL,
	`published_at` integer NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_uuid_unique` ON `news` (`uuid`);--> statement-breakpoint
CREATE INDEX `news_published_at_idx` ON `news` (`published_at`);--> statement-breakpoint
CREATE TABLE `news_symbols` (
	`news_id` integer NOT NULL,
	`symbol` text NOT NULL,
	PRIMARY KEY(`news_id`, `symbol`),
	FOREIGN KEY (`news_id`) REFERENCES `news`(`id`) ON UPDATE no action ON DELETE cascade
);
