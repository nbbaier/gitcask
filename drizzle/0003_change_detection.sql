ALTER TABLE `repos` ADD `last_pushed_at` text;--> statement-breakpoint
ALTER TABLE `repos` ADD `last_backup_at` text;--> statement-breakpoint
ALTER TABLE `repos` ADD `min_full_backup_days` integer DEFAULT 7 NOT NULL;
