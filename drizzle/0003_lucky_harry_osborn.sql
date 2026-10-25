CREATE TABLE `ai_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer,
	`tool` text NOT NULL,
	`summary` text NOT NULL,
	`changes` text NOT NULL,
	`created_at` integer NOT NULL,
	`undone_at` integer
);
