CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`default_provider` text DEFAULT 'anthropic' NOT NULL,
	`default_mode` text DEFAULT 'api' NOT NULL,
	`default_model` text DEFAULT 'claude-opus-4-7' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`mjml` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `templates_updated_idx` ON `templates` (`updated_at`);