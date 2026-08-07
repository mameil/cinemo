CREATE TABLE `crawl_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`machine` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`events` integer,
	`screenings` integer,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `crawl_runs_started_idx` ON `crawl_runs` (`started_at`);