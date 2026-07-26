CREATE UNIQUE INDEX `events_chain_source_unq` ON `events` (`chain`,`source_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `goodies_event_source_unq` ON `goodies` (`event_id`,`source_goods_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `goods_stock_goodie_theater_unq` ON `goods_stock` (`goodie_id`,`theater_id`);--> statement-breakpoint
CREATE INDEX `movies_title_idx` ON `movies` (`title`);--> statement-breakpoint
CREATE INDEX `movies_kobis_code_idx` ON `movies` (`kobis_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `theaters_chain_branch_unq` ON `theaters` (`chain`,`chain_branch_code`);