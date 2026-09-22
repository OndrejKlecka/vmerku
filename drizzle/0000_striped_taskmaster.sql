CREATE TABLE `notification_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`store_id` integer NOT NULL,
	`sale_window_start` integer NOT NULL,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notif_product_store_window` ON `notification_log` (`product_id`,`store_id`,`sale_window_start`);--> statement-breakpoint
CREATE TABLE `price_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`store_id` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`price` real NOT NULL,
	`regular_price` real,
	`is_sale` integer DEFAULT false NOT NULL,
	`sale_valid_from` integer,
	`sale_valid_to` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `obs_product_store_time` ON `price_observations` (`product_id`,`store_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `product_store_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`store_id` integer NOT NULL,
	`matched_name` text NOT NULL,
	`confidence` real NOT NULL,
	`confirmed_by_user` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alias_product_store_name` ON `product_store_aliases` (`product_id`,`store_id`,`matched_name`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonical_name` text NOT NULL,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `store_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`raw_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`price` real NOT NULL,
	`regular_price` real,
	`is_sale` integer DEFAULT false NOT NULL,
	`sale_valid_from` integer,
	`sale_valid_to` integer,
	`seen_at` integer NOT NULL,
	`source_ref` text,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `items_store_normalized` ON `store_items` (`store_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`source_url` text NOT NULL,
	`leaflet_day` integer,
	`active` integer DEFAULT true NOT NULL,
	`color_index` integer DEFAULT 0 NOT NULL,
	`last_checked_at` integer,
	`last_source_hash` text
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`notify_mode` text DEFAULT 'instant' NOT NULL,
	`include_unchanged` integer DEFAULT false NOT NULL,
	`last_digest_at` integer
);
