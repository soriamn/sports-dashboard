CREATE TABLE `external_ref` (
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	PRIMARY KEY(`provider`, `entity_type`, `external_id`)
);
--> statement-breakpoint
CREATE INDEX `external_ref_entity_idx` ON `external_ref` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `standing` (
	`competition_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`table_name` text NOT NULL,
	`rank` integer NOT NULL,
	`points` real NOT NULL,
	`stats` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`competition_id`, `participant_id`, `table_name`),
	FOREIGN KEY (`competition_id`) REFERENCES `competition`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `standing_participant_id_idx` ON `standing` (`participant_id`);