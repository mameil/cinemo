CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`movie_id` integer,
	`chain` text NOT NULL,
	`event_name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`source_event_id` text,
	`source_url` text,
	`image_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `goodies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`image_url` text,
	`source_goods_id` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `goods_stock` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goodie_id` integer NOT NULL,
	`theater_id` integer NOT NULL,
	`status` text NOT NULL,
	`remaining_qty` integer,
	`total_qty` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`goodie_id`) REFERENCES `goodies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`theater_id`) REFERENCES `theaters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `movies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`kobis_code` text,
	`tmdb_id` integer,
	`poster_url` text,
	`release_date` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `raw_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`source_id` text,
	`raw_json` text,
	`image_urls` text,
	`parse_status` text DEFAULT 'pending',
	`parsed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `theaters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chain` text NOT NULL,
	`branch_name` text NOT NULL,
	`region` text,
	`chain_branch_code` text
);
