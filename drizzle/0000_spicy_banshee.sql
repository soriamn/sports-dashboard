CREATE TABLE `competition` (
	`id` text PRIMARY KEY NOT NULL,
	`sport_id` text NOT NULL,
	`name` text NOT NULL,
	`season` text NOT NULL,
	`country` text,
	FOREIGN KEY (`sport_id`) REFERENCES `sport`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `competition_sport_id_idx` ON `competition` (`sport_id`);--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`time_confirmed` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`round` text,
	`venue` text,
	`details` text NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competition`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_competition_starts_at_idx` ON `event` (`competition_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `event_starts_at_idx` ON `event` (`starts_at`);--> statement-breakpoint
CREATE TABLE `event_participant` (
	`event_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`role` text NOT NULL,
	`outcome` text,
	PRIMARY KEY(`event_id`, `participant_id`),
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_participant_participant_id_idx` ON `event_participant` (`participant_id`);--> statement-breakpoint
CREATE TABLE `participant` (
	`id` text PRIMARY KEY NOT NULL,
	`sport_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text,
	`country` text,
	`image_url` text,
	FOREIGN KEY (`sport_id`) REFERENCES `sport`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `participant_sport_id_idx` ON `participant` (`sport_id`);--> statement-breakpoint
CREATE TABLE `sport` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
