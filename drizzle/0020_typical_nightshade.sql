CREATE TABLE `passwordResetTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `passwordResetTokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_passwordResetTokens_tokenHash` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE INDEX `idx_passwordResetTokens_userId` ON `passwordResetTokens` (`userId`);