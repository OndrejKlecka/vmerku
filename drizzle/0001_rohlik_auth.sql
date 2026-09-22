CREATE TABLE `rohlik_auth` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`redirect_url` text,
	`client_information` text,
	`tokens` text,
	`code_verifier` text,
	`state` text,
	`connected_at` integer,
	`last_error` text
);
