CREATE TABLE `waitlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(50),
	`country` varchar(100) NOT NULL,
	`userType` enum('retail_trader','institutional','fund_manager','other') NOT NULL,
	`selectedPlan` enum('starter','professional','enterprise'),
	`status` enum('pending','contacted','invited','converted') NOT NULL DEFAULT 'pending',
	`source` varchar(100),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`invitedAt` timestamp,
	`convertedAt` timestamp,
	CONSTRAINT `waitlist_id` PRIMARY KEY(`id`),
	CONSTRAINT `waitlist_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE INDEX `idx_waitlist_email` ON `waitlist` (`email`);--> statement-breakpoint
CREATE INDEX `idx_waitlist_status` ON `waitlist` (`status`);--> statement-breakpoint
CREATE INDEX `idx_waitlist_userType` ON `waitlist` (`userType`);--> statement-breakpoint
CREATE INDEX `idx_waitlist_createdAt` ON `waitlist` (`createdAt`);